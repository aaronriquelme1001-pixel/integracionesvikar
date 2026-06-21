---
name: b2b-billing-engine-rules
description: Rules for the billing_snapshot cronjob, including odometer calculation and driver grading.
---

# B2B Billing Engine Rules

The `billing_snapshot.js` script runs daily to generate a snapshot of every active vehicle for client billing.

## 1. Absolute Fleet Count
The billing engine DOES NOT filter out offline or parked vehicles. It intentionally requests `OBJECT_GET_LOCATIONS` for ALL vehicles assigned to a client to generate an absolute count of billable assets for that day.

## 2. The Odometer "Zero" Day
On the very first day a vehicle is registered in the engine, its odometer "driven today" metric will naturally be 0, because the engine requires a `Day 2` snapshot to calculate the delta `(Max - Min)`. This is mathematically correct and should not be treated as a bug.

## 3. Driver Fatigue Algorithm
The daily grade starts at `7.0` (Chilean grading scale). 
The algorithm calculates continuous driving time. If a driver drives at `> 5 km/h` for more than 5 uninterrupted hours (18,000,000 ms) without a 30-minute break, a `0.5` penalty is applied to the grade. Other penalties include speeding and harsh braking. The lowest possible score is `1.0`.
