# Reflection Notes
## ShopAWS - Capstone Project

---

## Overview

This capstone project involved designing and implementing a production-grade, resilient e-commerce application on AWS. The following reflections capture key lessons learned, trade-offs encountered, and potential improvements identified during implementation.

---

## Trade-offs: Cost vs Resilience

### 1. RDS Multi-AZ vs Single Instance

| Option | Monthly Cost | Resilience |
|---|---|---|
| RDS Single instance (db.t3.micro) | ~$15/month | No redundancy - single point of failure |
| RDS Multi-AZ (db.t3.micro) | ~$29/month | 99.95% uptime, automatic failover |

**Decision:** We chose Multi-AZ despite the doubled cost because database availability is non-negotiable for an e-commerce platform. A single RDS instance failure would take the entire application down. The additional ~$14/month is justified by the business impact of downtime.

**Lesson learned:** For mission-critical data stores, the cost of Multi-AZ is almost always justified. Downtime costs more than redundancy.

---

### 2. ElastiCache vs Direct RDS Queries

| Option | Added Cost | Benefit |
|---|---|---|
| No cache (direct RDS) | $0 | Simpler architecture |
| ElastiCache Redis (cache.t3.micro) | ~$12/month | 80% reduction in RDS queries |

**Decision:** ElastiCache was added to cache product catalog data. During the load test (52 req/sec), without caching all requests would hit RDS, potentially overwhelming the db.t3.micro instance. With Redis, repeated product listing requests are served from memory in under 1ms vs 20–50ms from RDS.

**Lesson learned:** Caching is one of the most cost-effective ways to improve performance and reduce database costs at scale.

---

### 3. Fargate vs EC2 for Order Processing

| Option | Cost model | Complexity |
|---|---|---|
| EC2 worker | Fixed cost always running | Medium - need to manage instance |
| Fargate | Pay per task runtime | Low - serverless, auto-scales |

**Decision:** Fargate was chosen for the order processor because it scales to zero when the queue is empty (saving cost) and scales up automatically when orders spike. For an e-commerce workload with unpredictable order volume, this is the right trade-off.

**Lesson learned:** Serverless/container workloads are ideal for event-driven processing where demand is unpredictable.

---

### 4. DynamoDB Global Tables vs Single Region

| Option | Cost | Benefit |
|---|---|---|
| Single region DynamoDB | Lower | No regional redundancy |
| Global Tables (2 regions) | ~2x writes cost | Active-active multi-region replication |

**Decision:** Global Tables were configured for session storage and product catalog. The cost increase is justified because if us-east-1 fails, users in us-west-2 continue with uninterrupted sessions - critical for an e-commerce platform where lost sessions mean abandoned carts.

**Lesson learned:** For session data, global replication is essential. Losing a user's session = losing a sale.

---

## Trade-offs: Complexity vs Reliability

### 1. Auto Scaling Group adds operational complexity

Adding an ASG means managing launch templates, AMI versioning, scaling policies, and instance refresh strategies. However, the reliability benefit - automatic instance replacement and traffic-based scaling - far outweighs the added complexity.

**Key complexity introduced:**
- Launch templates must be kept up to date when app changes
- AMI must be rebuilt when dependencies change
- Scaling policies need tuning based on real traffic patterns

**Mitigation:** Use a CI/CD pipeline to automatically build new AMIs on code changes (future improvement).

---

### 2. SQS + Fargate decoupling increases moving parts

Instead of processing orders synchronously in the web app, we introduced SQS and Fargate - two additional services to manage. This adds:
- Monitoring requirements (queue depth, DLQ messages)
- Debugging complexity (where did an order fail?)
- IAM permissions management

**However, the reliability gain is significant:**
- Web app never slows down due to order processing
- Failed orders are retried automatically
- DLQ captures orders that couldn't be processed for investigation

**Lesson learned:** Decoupling is worth the complexity for workloads that can tolerate asynchronous processing.

---

### 3. Route 53 failover requires careful configuration

Multi-region failover with Route 53 requires health checks, secondary region infrastructure, and DNS TTL management. Misconfiguration can result in:
- Traffic not failing over when it should
- Traffic failing over when it shouldn't (false positives)
- Long failover times due to DNS TTL being too high

**Lesson learned:** Always test DR failover before you need it. A runbook that has never been tested is not a runbook.

---

## What Went Well

1. **ALB + Multi-AZ EC2** - straightforward to configure, immediately demonstrated load balancing by showing different AZ badges on page refresh
2. **RDS Multi-AZ** - AWS handles all the complexity of synchronous replication and automatic failover
3. **Artillery load test** - clearly demonstrated the application's ability to handle 52 req/sec with 99.94% success rate
4. **DynamoDB Global Tables** - one-click replication to a second region with no application changes needed

---

## What Was Challenging

1. **EC2 user data scripts** - heredoc syntax on macOS introduced escape character issues in Node.js files, requiring multiple debugging iterations. Switching to PHP/Apache resolved this.
2. **Fargate IAM permissions** - getting the task execution role correctly configured to access SQS required careful policy setup
3. **ElastiCache connectivity** - Redis is only accessible from within the VPC; this is correct but initially confusing when testing from a browser

---

## Potential Improvements

### Short-term
- [ ] Add HTTPS (SSL/TLS) to the ALB using AWS Certificate Manager
- [ ] Implement a CI/CD pipeline (CodePipeline + CodeBuild) for automated deployments
- [ ] Add WAF (Web Application Firewall) in front of ALB for security
- [ ] Configure CloudWatch detailed monitoring on all EC2 instances

### Medium-term
- [ ] Migrate from t2.micro to t3.micro or c5.large for better performance
- [ ] Implement RDS Read Replicas for read-heavy workloads
- [ ] Add CloudFront CDN in front of ALB for global content delivery
- [ ] Implement blue/green deployments via CodeDeploy

### Long-term
- [ ] Migrate to containerized app on ECS/Fargate for the web tier (remove EC2 dependency)
- [ ] Implement service mesh (App Mesh) for microservices communication
- [ ] Add X-Ray distributed tracing for end-to-end request visibility
- [ ] Implement chaos engineering (AWS Fault Injection Simulator) for regular DR testing

---

## Key Lessons Learned

1. **Design for failure from day one** - every single component in this architecture has a redundant counterpart. This mindset should be the default, not an afterthought.

2. **Automate everything** - manual recovery processes are error-prone under pressure. Auto Scaling, RDS Multi-AZ, and Route 53 failover all happen without human intervention.

3. **Test your DR plan** - we simulated instance failures and RDS failovers during the capstone. Without testing, a DR plan is just a document.

4. **Cost and resilience are not opposites** - with smart choices (Fargate for spiky workloads, Reserved Instances for baseline, caching to reduce DB costs), you can achieve high resilience without proportionally high costs.

5. **Start simple, add complexity only when needed** - we started with 2 EC2 instances behind an ALB. Each additional component (ElastiCache, SQS, Fargate) was added to solve a specific problem, not for its own sake.

---

## Final Architecture Assessment

| Dimension | Score | Notes |
|---|---|---|
| Availability | 9/10 | Multi-AZ + Multi-Region. Would need active-active multi-region for 10/10 |
| Scalability | 8/10 | ASG + Fargate auto-scale well. Web tier could also use Fargate |
| Recoverability | 9/10 | RTO ~2 min, RPO ~0. Automated failover for most scenarios |
| Security | 6/10 | Security groups in place but no WAF, no HTTPS, no secrets manager |
| Cost efficiency | 7/10 | Credits cover costs; production would benefit from Reserved Instances |
| Operational excellence | 7/10 | CloudWatch dashboards in place; CI/CD pipeline would improve score |
