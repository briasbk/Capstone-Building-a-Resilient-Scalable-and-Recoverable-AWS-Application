# Scaling Test Report
## ShopAWS — Capstone Project

---

## Test Overview

| Property | Value |
|---|---|
| Tool | Artillery v2.0.31 |
| Target | http://ecommerce-alb-434123993.us-east-1.elb.amazonaws.com |
| Test date | May 12, 2026 |
| Total duration | 4 minutes (240 seconds) |

---

## Test Configuration

The load test was designed to simulate a realistic e-commerce traffic spike during a promotional event, with three distinct phases:

```yaml
phases:
  - name: Warm up
    duration: 60s
    arrivalRate: 5 users/sec

  - name: Traffic spike
    duration: 120s
    arrivalRate: 50 users/sec

  - name: Cool down
    duration: 60s
    arrivalRate: 5 users/sec
```

Each virtual user browsed the store homepage 3 times per session, simulating realistic page browsing behavior.

---

## Test Results

### Summary Metrics

| Metric | Value |
|---|---|
| Total HTTP requests sent | 19,776 |
| Successful responses (HTTP 200) | 19,764 |
| Failed requests (timeout) | 12 |
| **Success rate** | **99.94%** |
| Request rate (peak) | 52 requests/sec |
| Virtual users created | 6,600 |
| Virtual users completed | 6,588 |
| Virtual users failed | 12 |

### Response Time Distribution

| Percentile | Response Time |
|---|---|
| Minimum | 148ms |
| Mean (average) | 306.9ms |
| Median (p50) | 290.1ms |
| p95 | 424.2ms |
| p99 | 620.3ms |
| Maximum | 1,921ms |

### Session Length Distribution

| Percentile | Session Length |
|---|---|
| Minimum | 960.4ms |
| Mean | 1,260.9ms |
| Median | 1,224.4ms |
| p95 | 1,652.8ms |
| p99 | 2,369ms |

---

## Phase-by-Phase Analysis

### Phase 1 — Warm Up (0–60s, 5 users/sec)
- System responded normally
- Response times stable around 150–200ms
- Both EC2 instances serving traffic evenly via ALB
- No scaling events triggered

### Phase 2 — Traffic Spike (60–180s, 50 users/sec)
- Request rate jumped to 52 requests/second
- Response times increased to mean of 306.9ms — still within acceptable range
- ASG CPU utilization increased across instances
- ALB successfully distributed load across both AZs (us-east-1b and us-east-1d)
- 12 socket timeouts observed (0.06% of total) — negligible failure rate

### Phase 3 — Cool Down (180–240s, 5 users/sec)
- Traffic reduced back to baseline
- Response times returned to normal
- System stable throughout

---

## Auto Scaling Behavior

| Property | Value |
|---|---|
| ASG Name | ecommerce-asg |
| Min instances | 2 |
| Desired instances | 2 |
| Max instances | 4 |
| Scale-out policy | CPU > 50% for 5 minutes |

**Observation:** The t2.micro instances handled the 52 req/sec spike with a 99.94% success rate. The ASG scaling policy uses a 5-minute cooldown before triggering scale-out, meaning a sustained spike longer than 5 minutes would trigger additional instances (up to 4 max). For this 2-minute spike, the existing 2 instances handled the load effectively.

---

## Conclusions

| Criterion | Result |
|---|---|
| Application stability under load | ✅ 99.94% success rate |
| Response time acceptable | ✅ p99 under 620ms |
| Load balancing across AZs | ✅ ALB distributed traffic evenly |
| ASG scaling configured | ✅ Scale-out at CPU > 50%, max 4 instances |
| No single point of failure | ✅ Both AZs served traffic throughout |

### Recommendations for Production
- Lower ASG scale-out cooldown from 5 minutes to 2 minutes for faster response to spikes
- Add ALB request count as a secondary scaling metric
- Use c5.large instances instead of t2.micro for sustained high traffic
- Implement Redis caching to reduce RDS load during traffic spikes
