# ShopAWS — Capstone Project

**Primary Region:** us-east-1 (N. Virginia)  
**DR Region:** us-west-2 (Oregon)  
**Live:** http://soliddigital.co.ke

---

## What This Is

ShopAWS is my capstone project — a PHP/Apache e-commerce demo built to be resilient, scalable, and recoverable on AWS. The scenario is pretty realistic: you have a store that needs to handle unpredictable traffic, survive infrastructure failures without going dark, and recover fast if something really goes wrong at the region level.

I organized the work into three phases. Phase 1 was about eliminating single points of failure. Phase 2 added auto-scaling and async order processing so the app can handle load spikes without falling over. Phase 3 covered cross-region disaster recovery with a tested failover and documented runbook.

Live endpoints if you want to poke around:

| Endpoint | What it is |
|---|---|
| http://soliddigital.co.ke | Primary (Route 53 managed) |
| http://ecommerce-alb-434123993.us-east-1.elb.amazonaws.com | Primary ALB, direct access |
| http://ecommerce-alb-dr-221729531.us-west-2.elb.amazonaws.com | DR ALB in us-west-2 |

---

## Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │         Users / Internet          │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │         Route 53 (DNS)            │
                    │   soliddigital.co.ke              │
                    │   Failover routing policy         │
                    │   Health check: 10s interval      │
                    └──────┬────────────────┬──────────┘
                           │                │
                    Primary │                │ Secondary
                    (us-east-1)        (us-west-2 DR)
                           │                │
          ┌────────────────▼──┐    ┌────────▼───────────────┐
          │  ALB (us-east-1)  │    │   ALB (us-west-2)      │
          │  ecommerce-alb    │    │   ecommerce-alb-dr      │
          └──────┬────────────┘    └────────┬───────────────┘
                 │                           │
     ┌───────────┴──────────┐      ┌─────────┴─────────────┐
     │  us-east-1b          │      │  us-west-2 (DR)       │
     │  ┌───────────────┐   │      │  ┌────────────────┐   │
     │  │ EC2 (ASG)     │   │      │  │ EC2 (DR)       │   │
     │  │ Apache + PHP  │   │      │  │ Apache + PHP   │   │
     │  └───────────────┘   │      │  └────────────────┘   │
     │  us-east-1d          │      └───────────────────────┘
     │  ┌───────────────┐   │
     │  │ EC2 (ASG)     │   │
     │  │ Apache + PHP  │   │
     │  └───────────────┘   │
     └──────────────────────┘
              │
     ┌────────┴──────────────────────────────────────┐
     │              Data Layer                        │
     │                                                │
     │  ┌──────────────┐   ┌────────────────────┐    │
     │  │ RDS MySQL    │   │ ElastiCache Redis   │    │
     │  │ Multi-AZ     │   │ Primary + Replica   │    │
     │  │ Primary +    │   │ Multi-AZ enabled    │    │
     │  │ Standby      │   └────────────────────┘    │
     │  └──────────────┘                              │
     │  ┌────────────────────────────────────────┐   │
     │  │ DynamoDB Global Tables                  │   │
     │  │ sessions + products                     │   │
     │  │ us-east-1 and us-west-2 active-active   │   │
     │  └────────────────────────────────────────┘   │
     └───────────────────────────────────────────────┘
              │
     ┌────────┴──────────────────────────────────────┐
     │         Order Processing Layer                 │
     │                                                │
     │  ┌─────────────┐   ┌────────────────────┐     │
     │  │ Amazon SQS  │──►│ ECS Fargate        │     │
     │  │ Orders queue│   │ Order processor    │     │
     │  │ + DLQ       │   │ Auto-scales 1-5    │     │
     │  └─────────────┘   └────────────────────┘     │
     └───────────────────────────────────────────────┘
```

---

## Phase 1 — High Availability

The first thing I tackled was making sure no single component could take the whole app down.

### Load Balancer

| Property | Value |
|---|---|
| Name | ecommerce-alb |
| Scheme | Internet-facing |
| DNS | ecommerce-alb-434123993.us-east-1.elb.amazonaws.com |
| Listener | HTTP:80 → ecommerce-tg |
| Health check path | / |
| Availability Zones | us-east-1b, us-east-1d |

### EC2 Instances

Ran two instances across two AZs from the start. If one AZ goes down, the other keeps serving traffic.

| Instance | AZ | Subnet |
|---|---|---|
| ecommerce-web-az-b | us-east-1b | subnet-08600ccb4bcc0a2a3 |
| ecommerce-web-az-d | us-east-1d | subnet-03cccc226fd215bf1 |

Both run Ubuntu 24.04 with Apache2 and PHP 8.3, baked into a custom AMI (`ami-0f5dd1ed99b5d5156`) so new instances come up with everything already configured.

### RDS (Multi-AZ)

| Property | Value |
|---|---|
| Identifier | database-1 |
| Engine | MySQL 8.0 |
| Instance class | db.t3.micro |
| Multi-AZ | Yes |
| Endpoint | database-1.c470eai86395.us-east-1.rds.amazonaws.com |
| Backup retention | 7 days |
| PITR | Enabled |

Multi-AZ means AWS keeps a standby in a different AZ. If the primary dies, AWS promotes the standby automatically — usually within 60 seconds, no manual steps needed.

### DynamoDB Global Tables

Rather than storing sessions in a database that only lives in one region, I used DynamoDB Global Tables. Sessions and product catalog data replicate actively across both regions, so a us-east-1 failure doesn't log anyone out or break product pages.

| Table | Purpose | Regions |
|---|---|---|
| ecommerce-sessions | User session storage | us-east-1 + us-west-2 |
| ecommerce-products | Product catalog cache | us-east-1 + us-west-2 |

### SPOFs Identified and Addressed

| Problem | Risk | What I did |
|---|---|---|
| Single EC2 instance | App dies if instance fails | ALB + 2 EC2s in 2 AZs + ASG |
| Single AZ | All traffic hits one location | Instances spread across us-east-1b and us-east-1d |
| Single RDS | DB unavailable on failure | Multi-AZ with auto-failover |
| Single region | Complete outage | Route 53 failover to us-west-2 |
| Session storage in one place | Users get logged out on failover | DynamoDB Global Tables |

---

## Phase 2 — Scalability

Once the app was highly available, I wired up auto-scaling and moved order processing off the critical path.

### Auto Scaling Group

| Property | Value |
|---|---|
| Name | ecommerce-asg |
| Launch Template | lt-0e9f37c00927b77bd |
| Min / Desired / Max | 2 / 2 / 4 |
| Scale-out trigger | CPU > 50% |
| Scale-in trigger | CPU < 50% |

### SQS Order Queue

Orders go into SQS the moment a customer checks out. The web app doesn't wait for processing to finish — it just drops the message and moves on. That keeps response times fast even under heavy load.

| Resource | Value |
|---|---|
| Queue | ecommerce-orders-queue |
| URL | https://sqs.us-east-1.amazonaws.com/508471420037/ecommerce-orders-queue |
| DLQ | ecommerce-orders-dlq |
| Retries before DLQ | 3 |
| Message retention | 4 days |
| Long polling | 10 seconds |

Failed messages retry 3 times before landing in the DLQ where they can be inspected without being lost.

### Fargate Order Processor

A containerized processor pulls from the SQS queue and handles order fulfillment. It scales independently from the web tier.

| Property | Value |
|---|---|
| Cluster | ecommerce-cluster |
| Service | ecommerce-order-processor-service |
| Image | 508471420037.dkr.ecr.us-east-1.amazonaws.com/ecommerce-order-processor:latest |
| CPU / Memory | 0.25 vCPU / 0.5 GB |
| Min / Max tasks | 1 / 5 |
| Scaling target | ECS CPU utilization at 50% |

### ElastiCache Redis

Product listings don't change that often, so caching them in Redis made sense. Reads that previously hit MySQL (20–50ms) now come back in under a millisecond, which reduces database pressure a lot during spikes.

| Property | Value |
|---|---|
| Engine | Redis OSS 7.1 |
| Node type | cache.t3.micro |
| Multi-AZ | Enabled |
| Replicas | 1 |
| Primary endpoint | master.ecommerce-redis.9od21m.use1.cache.amazonaws.com:6379 |

---

## Phase 3 — Disaster Recovery

Full step-by-step recovery procedures are in the [DR Runbook](./dr-runbook.md). Here's the summary.

### RTO/RPO

| Metric | Target | Achieved |
|---|---|---|
| RTO (max downtime) | < 5 minutes | ~2 minutes |
| RPO (max data loss) | < 1 minute | ~0 seconds |

### Backups

| Resource | Schedule | Retention | PITR |
|---|---|---|---|
| RDS | Daily | 7 days | Yes |
| DynamoDB | Daily | 7 days | Yes |
| Weekly backup | Weekly | 30 days | N/A |

Backups are stored in `ecommerce-backup-vault` with cross-region copies going to us-west-2.

### Route 53 Failover

| Record | Target | Role |
|---|---|---|
| soliddigital.co.ke | ecommerce-alb (us-east-1) | Primary |
| soliddigital.co.ke | ecommerce-alb-dr (us-west-2) | Secondary |

Health checks run every 10 seconds. Three consecutive failures trigger DNS failover — realistically 30–90 seconds to cut over.

### DR Test Results

I simulated a region failure by zeroing out the ASG and watching what happened.

| Event | Time | What happened |
|---|---|---|
| Set ASG desired to 0 | 0:00 | EC2s start terminating |
| Health check fails | ~0:30 | Route 53 detects the problem |
| DNS failover | ~1:30 | Route 53 points to us-west-2 |
| DR site loading | ~2:00 | Red "DR" banner confirms secondary is serving traffic |
| ASG restored | 3:00 | us-east-1 instances start relaunching |
| Health check recovers | ~5:00 | Traffic shifts back to primary |
| **Total RTO** | **~2 min** | Under the 5-minute target |
| **Data loss** | **None** | DynamoDB Global Tables held everything |

---

## Observability

### CloudWatch Dashboard: `ecommerce-dashboard`

| Widget | Metric | Source |
|---|---|---|
| EC2 CPU | CPUUtilization | ecommerce-asg |
| ALB Request Count | RequestCount | ecommerce-alb |
| RDS Connections | DatabaseConnections | database-1 |
| Queue Depth | ApproximateNumberOfMessages | ecommerce-orders-queue |
| Cache Hit Rate | CacheHits / CacheMisses | ecommerce-redis |

### Alarms

| Alarm | Threshold | Action |
|---|---|---|
| ecommerce-high-cpu | EC2 CPU > 80% for 5 min | SNS → ecommerce-alerts |
| ecommerce-unhealthy-hosts | ALB unhealthy host count > 0 for 1 min | SNS → ecommerce-alerts |
| ecommerce-queue-depth | SQS messages > 100 | SNS → ecommerce-alerts |

### Logs

| Source | Location |
|---|---|
| Apache access logs | `/var/log/apache2/access.log` on each EC2 |
| Apache error logs | `/var/log/apache2/error.log` on each EC2 |
| Order processor (Fargate) | CloudWatch Logs: `/ecs/ecommerce-order-processor` |
| RDS logs | RDS Console → Logs and events |

---

## Related Docs

- [Scaling Test Report](./scaling-test-report.md)
- [DR Runbook](./dr-runbook.md)
- [Reflection Notes](./reflection-notes.md)