# ShopAWS - Resilient, Scalable, and Recoverable AWS Application
## Capstone Project Documentation

**Student:** BriasK  
**Account ID:** 508471420037  
**Primary Region:** us-east-1 (N. Virginia)  
**DR Region:** us-west-2 (Oregon)  
**Live URL:** http://soliddigital.co.ke  

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Phase 1 - High Availability](#phase-1--high-availability)
4. [Phase 2 - Scalability](#phase-2--scalability)
5. [Phase 3 - Disaster Recovery](#phase-3--disaster-recovery)
6. [Observability and Operations](#observability-and-operations)
7. [Scaling Test Report](./scaling-test-report.md)
8. [DR Runbook](./dr-runbook.md)
9. [Reflection Notes](./reflection-notes.md)

---

## Project Overview

**Scenario:** Design and implement a mission-critical e-commerce web application on AWS that handles unpredictable traffic spikes, remains available during partial infrastructure failures, and supports rapid recovery from disaster events.

**Application:** ShopAWS - a PHP/Apache demo e-commerce store serving product listings across multiple AWS Availability Zones and Regions.

**Live endpoints:**

| Endpoint | Purpose |
|---|---|
| http://soliddigital.co.ke | Primary (Route 53 managed) |
| http://ecommerce-alb-434123993.us-east-1.elb.amazonaws.com | Primary ALB direct |
| http://ecommerce-alb-dr-221729531.us-west-2.elb.amazonaws.com | DR ALB direct |

---

## Architecture Diagram

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

## Phase 1 - High Availability

### Application Load Balancer
| Property | Value |
|---|---|
| Name | ecommerce-alb |
| Scheme | Internet-facing |
| DNS | ecommerce-alb-434123993.us-east-1.elb.amazonaws.com |
| Listener | HTTP:80 → ecommerce-tg |
| Health check path | / |
| Availability Zones | us-east-1b, us-east-1d |

### EC2 Instances (Multi-AZ)
| Instance | AZ | Subnet |
|---|---|---|
| ecommerce-web-az-b | us-east-1b | subnet-08600ccb4bcc0a2a3 |
| ecommerce-web-az-d | us-east-1d | subnet-03cccc226fd215bf1 |

- OS: Ubuntu Server 24.04 LTS
- Runtime: Apache2 + PHP 8.3
- Custom AMI: ami-0f5dd1ed99b5d5156

### RDS Multi-AZ
| Property | Value |
|---|---|
| Identifier | database-1 |
| Engine | MySQL 8.0 |
| Instance class | db.t3.micro |
| Multi-AZ | Yes (Primary + Standby) |
| Endpoint | database-1.c470eai86395.us-east-1.rds.amazonaws.com |
| Backup retention | 7 days |
| PITR | Enabled |

**Failover behavior:** If the primary RDS instance fails, AWS automatically promotes the standby in the other AZ within 60 seconds with no manual intervention.

### DynamoDB Global Tables
| Table | Purpose | Regions |
|---|---|---|
| ecommerce-sessions | User session storage | us-east-1 and us-west-2 |
| ecommerce-products | Product catalog cache | us-east-1 and us-west-2 |

**Justification:** Active-active replication means if us-east-1 fails, us-west-2 continues serving reads and writes with zero data loss.

### Single Points of Failure - Identified and Resolved
| SPOF | Risk | Resolution |
|---|---|---|
| Single EC2 instance | App down if instance fails | ALB + 2 EC2s across 2 AZs + ASG |
| Single AZ failure | All instances down | Instances in us-east-1b AND us-east-1d |
| Single RDS instance | Database unavailable | RDS Multi-AZ with auto-failover |
| Single region failure | Complete outage | Route 53 failover to us-west-2 |
| Session data loss | Users logged out | DynamoDB Global Tables |

---

## Phase 2 - Scalability

### Auto Scaling Group
| Property | Value |
|---|---|
| Name | ecommerce-asg |
| Launch Template | lt-0e9f37c00927b77bd |
| Custom AMI | ami-0f5dd1ed99b5d5156 |
| Minimum instances | 2 |
| Desired instances | 2 |
| Maximum instances | 4 |
| Scale-out trigger | CPU utilization > 50% |
| Scale-in trigger | CPU utilization < 50% |

### SQS Order Processing
| Resource | Value |
|---|---|
| Queue name | ecommerce-orders-queue |
| Queue URL | https://sqs.us-east-1.amazonaws.com/508471420037/ecommerce-orders-queue |
| Dead Letter Queue | ecommerce-orders-dlq |
| Max receives before DLQ | 3 |
| Message retention | 4 days |
| Long polling | 10 seconds |

**Architecture:** Orders are dropped into SQS asynchronously - the web app never slows down due to order processing. Failed orders retry 3 times before going to DLQ for investigation.

### Fargate Order Processor
| Property | Value |
|---|---|
| Cluster | ecommerce-cluster |
| Service | ecommerce-order-processor-service |
| ECR Image | 508471420037.dkr.ecr.us-east-1.amazonaws.com/ecommerce-order-processor:latest |
| CPU | 0.25 vCPU |
| Memory | 0.5 GB |
| Minimum tasks | 1 |
| Maximum tasks | 5 |
| Scaling metric | ECSServiceAverageCPUUtilization (target: 50%) |

### ElastiCache Redis
| Property | Value |
|---|---|
| Name | ecommerce-redis |
| Engine | Redis OSS 7.1 |
| Node type | cache.t3.micro |
| Multi-AZ | Enabled |
| Replicas | 1 |
| Primary endpoint | master.ecommerce-redis.9od21m.use1.cache.amazonaws.com:6379 |

**What is cached and why:** Product catalog data is cached in Redis because product listings change infrequently. Serving them from Redis (sub-millisecond) instead of RDS (20-50ms) reduces database load by up to 80% during traffic spikes.

---

## Phase 3 - Disaster Recovery

See [DR Runbook](./dr-runbook.md) for full step-by-step recovery procedures.

### RTO/RPO Targets and Achievement
| Metric | Definition | Target | Achieved |
|---|---|---|---|
| RTO | Max acceptable downtime | < 5 minutes | ~2 minutes |
| RPO | Max acceptable data loss | < 1 minute | ~0 seconds |

### AWS Backup Configuration
| Resource | Schedule | Retention | PITR |
|---|---|---|---|
| RDS (all databases) | Daily | 7 days | Enabled |
| DynamoDB (all tables) | Daily | 7 days | Enabled |
| Weekly backup | Weekly | 30 days | N/A |
| Vault | ecommerce-backup-vault | - | - |
| Cross-region copy | us-west-2 | Same | - |

### Route 53 Failover Configuration
| Record | Type | Target | Role |
|---|---|---|---|
| soliddigital.co.ke | A Alias | ecommerce-alb (us-east-1) | Primary |
| soliddigital.co.ke | A Alias | ecommerce-alb-dr (us-west-2) | Secondary |

- Health check name: ecommerce-primary-health
- Check interval: 10 seconds (Fast)
- Failure threshold: 3 consecutive failures
- Estimated failover time: 30-90 seconds

### DR Simulation Results
| Event | Time | Observation |
|---|---|---|
| ASG desired set to 0 | 0:00 | EC2 instances terminating in us-east-1 |
| Health check turns unhealthy | ~0:30 | Route 53 detects primary failure |
| DNS failover triggers | ~1:30 | Route 53 switches to secondary |
| DR site loads in browser | ~2:00 | Red header and DR banner visible |
| ASG restored to desired 2 | 3:00 | us-east-1 instances relaunching |
| Health check turns healthy | ~5:00 | Traffic returns to us-east-1 |
| **Total RTO achieved** | **~2 min** | Under 5 minute target |
| **Data loss observed** | **None** | DynamoDB Global Tables preserved all data |

---

## Observability and Operations

### CloudWatch Dashboard
**Name:** ecommerce-dashboard

| Widget | Metric | Source |
|---|---|---|
| EC2 CPU Utilization | CPUUtilization | ecommerce-asg |
| ALB Request Count | RequestCount | ecommerce-alb |
| RDS Connections | DatabaseConnections | database-1 |
| SQS Queue Depth | ApproximateNumberOfMessages | ecommerce-orders-queue |
| Cache Performance | CacheHits and CacheMisses | ecommerce-redis |

### CloudWatch Alarms
| Alarm Name | Metric | Threshold | Action |
|---|---|---|---|
| ecommerce-high-cpu | EC2 CPUUtilization | > 80% for 5 min | SNS: ecommerce-alerts |
| ecommerce-unhealthy-hosts | ALB UnHealthyHostCount | > 0 for 1 min | SNS: ecommerce-alerts |
| ecommerce-queue-depth | SQS ApproximateNumberOfMessages | > 100 | SNS: ecommerce-alerts |

### Application Logs
| Log Source | Location |
|---|---|
| Apache access logs | /var/log/apache2/access.log on each EC2 |
| Apache error logs | /var/log/apache2/error.log on each EC2 |
| Fargate order processor | CloudWatch Logs /ecs/ecommerce-order-processor |
| RDS logs | RDS Console → Logs and events tab |
