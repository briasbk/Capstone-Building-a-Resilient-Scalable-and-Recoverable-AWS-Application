# Disaster Recovery Runbook
## ShopAWS - Capstone Project

---

## RTO/RPO Definitions

| Metric | Definition | Target | Achieved |
|---|---|---|---|
| **RTO** (Recovery Time Objective) | Maximum acceptable downtime after a disaster | < 5 minutes | ~2 minutes |
| **RPO** (Recovery Point Objective) | Maximum acceptable data loss | < 1 minute | ~0 seconds |

### RTO/RPO Mapping to AWS Services

| AWS Service | RTO Contribution | RPO Contribution |
|---|---|---|
| Route 53 health checks | Detects failure in 30–90 seconds | N/A |
| RDS Multi-AZ auto-failover | Promotes standby in ~60 seconds | 0 data loss (synchronous replication) |
| ALB health checks | Removes unhealthy targets in 30 seconds | N/A |
| DynamoDB Global Tables | Active-active, no failover needed | 0 data loss (active-active) |
| ASG | Replaces unhealthy instances automatically | N/A |

---

## AWS Backup Policies

### RDS Backup Configuration
| Property | Value |
|---|---|
| Automated backups | Enabled |
| Backup retention period | 7 days |
| Backup window | AWS managed (default) |
| Point-in-time recovery | Enabled |
| Latest restorable time | Within 5 minutes of current time |

**How to restore RDS from backup:**
1. Go to **RDS → Databases → database-1**
2. Click **Actions → Restore to point in time**
3. Select the restore time
4. Choose instance class and VPC settings
5. Click **Restore DB instance**
6. Update application connection string to new endpoint

### DynamoDB Backup Configuration
| Property | Value |
|---|---|
| Point-in-time recovery (PITR) | Enabled |
| Backup retention | 35 days |
| Global Tables replication | us-east-1 ↔ us-west-2 |

**How to restore DynamoDB from backup:**
1. Go to **DynamoDB → Tables → ecommerce-sessions**
2. Click **Backups** tab
3. Click **Restore**
4. Enter new table name
5. Select restore point
6. Click **Restore table**

---

## Scenario 1 - Single EC2 Instance Failure

**Detection:** ALB health check fails for one target → target marked unhealthy → traffic routed to remaining instances.

**Automated recovery steps (no manual action needed):**
1. ALB detects unhealthy instance (30–60 second health check interval)
2. ALB stops routing traffic to failed instance
3. ASG detects instance is unhealthy
4. ASG launches replacement instance using `ecommerce-launch-template`
5. New instance passes health check and joins target group
6. Traffic resumes normally

**Expected RTO:** 2–3 minutes
**Expected RPO:** 0 (stateless app, sessions in DynamoDB)

**Validation steps:**
```bash
# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn <tg-arn>

# Check ASG activity
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name ecommerce-asg
```

---

## Scenario 2 - Availability Zone Failure

**Detection:** All instances in one AZ become unreachable.

**Automated recovery steps:**
1. ALB detects all targets in failed AZ are unhealthy
2. ALB routes 100% of traffic to instances in healthy AZ
3. ASG launches new instances in healthy AZ to meet desired capacity
4. RDS Multi-AZ promotes standby in healthy AZ if primary was in failed AZ

**Expected RTO:** 2–5 minutes
**Expected RPO:** 0 (RDS Multi-AZ synchronous replication)

**Manual validation steps:**
1. Go to **EC2 → Instances** - confirm instances in healthy AZ are running
2. Go to **RDS → database-1** - confirm status shows Available
3. Visit ALB DNS URL - confirm app is still accessible

---

## Scenario 3 - Primary Region Failure (us-east-1)

**This is the full DR scenario.** Follow these steps in order:

### Step 1 - Detect the failure (0–2 minutes)
- Route 53 health check fails 3 consecutive times (every 30 seconds)
- Route 53 automatically switches DNS to us-west-2 endpoint
- Users are redirected to DR region transparently

**Verify DNS failover:**
```bash
nslookup your-domain.com
# Should return us-west-2 ALB IP after failover
```

### Step 2 - Verify DR region is serving traffic (2–3 minutes)
1. Visit your domain - confirm app loads from us-west-2
2. Check us-west-2 ALB target group - confirm instances are healthy
3. Check DynamoDB Global Tables in us-west-2 - confirm data is available

### Step 3 - Failover RDS to us-west-2 (3–5 minutes)
1. Go to **RDS → database-1**
2. Click **Actions → Reboot with failover**
3. Confirm - standby in us-east-1d promotes to primary
4. If full region failure, restore RDS from snapshot in us-west-2:
   - Go to **RDS → Snapshots**
   - Select latest automated snapshot
   - Click **Restore snapshot**
   - Choose us-west-2 as region
   - Update application DB endpoint

### Step 4 - Confirm DynamoDB is available (automatic)
- DynamoDB Global Tables are active-active
- us-west-2 replica is already serving reads/writes
- No action needed

### Step 5 - Document the incident
Record:
- Time of failure detection
- Time of Route 53 failover
- Time of full recovery
- Any data loss observed
- Total downtime experienced

---

## Scenario 4 - RDS Primary Instance Failure

**Detection:** RDS Multi-AZ automatically detects primary failure.

**Automated recovery steps:**
1. RDS detects primary instance failure
2. AWS promotes standby instance to primary (~60 seconds)
3. DNS endpoint automatically points to new primary
4. Application reconnects automatically (may need connection pool refresh)

**Expected RTO:** ~60–120 seconds
**Expected RPO:** 0 (synchronous replication)

**Manual steps if automatic failover doesn't occur:**
1. Go to **RDS → database-1**
2. Click **Actions → Reboot with failover**
3. Click **Confirm**
4. Wait for status to return to **Available**

---

## Recovery Validation Checklist

After any DR event, verify:

- [ ] ALB DNS resolves correctly
- [ ] Application loads in browser (HTTP 200)
- [ ] AZ badge shows correct availability zone
- [ ] RDS status shows **Available**
- [ ] RDS Multi-AZ shows **Yes**
- [ ] DynamoDB tables show **Active** in target region
- [ ] ElastiCache shows **Available**
- [ ] SQS queue is processing messages
- [ ] Fargate tasks are running
- [ ] CloudWatch alarms are green

---

## Observed DR Test Results

| Test | Simulated failure | Detected in | Recovered in | Data loss |
|---|---|---|---|---|
| EC2 instance stop | Manual instance stop | 30 seconds | 2 minutes | None |
| RDS failover | Reboot with failover | Immediate | 90 seconds | None |
| AZ simulation | Stopped all instances in one AZ | 30 seconds | 3 minutes | None |
