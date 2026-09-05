# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Farm admins and technicians operating an aquaponics site in Bulacan, Philippines.
- **Admins** oversee the whole operation: users, sensor/alert configuration, automation rules, analytics, and assigning corrective actions.
- **Technicians** work on-site: check tasks assigned to them, respond to alerts, and log corrective actions (feeding, water changes, maintenance).
A separate Flutter mobile app (`flutter-latest/`, package `demo_1_langto`) exists for a lighter-weight audience (e.g. farm owner/status checks) but is out of scope for this PRODUCT.md; see Platform note below.

## Product Purpose

Bantay Ulang is an adaptive aquaponic monitoring system for growing "ulang" (freshwater prawn) alongside vegetables in a closed-loop system (fish waste feeds the vegetables, the vegetables help clean the water). The web dashboard exists to keep the loop healthy: it watches real-time sensor data, predicts ulang growth/survival, and turns anomalies into concrete assigned tasks before they become losses. Success means water-quality problems are caught and acted on before they hurt yield, and admins can see growth/survival trends with enough confidence to act on them.

## Positioning

The core differentiator is the ML-driven growth/survival prediction layer, not just live sensor dashboards. A Random Forest model (verified R2 0.79 vs. 0.27 for a plain multiple linear regression baseline, 5-fold cross-validated) forecasts ulang growth/yield from sensor history, and this prediction feeds the Growth & Survival Predictions analytics page. Real-time sensor monitoring and an alerts engine (auto-creates/resolves Firestore alert docs from `sensor_readings`) support that prediction layer rather than being the product's main claim.

## Operating Context

- Sensors write to `sensor_readings` in Firestore; an alerts engine (`alertsEngine.js`) evaluates readings and auto-creates/resolves alert documents, surfaced on Real-Time Monitoring and an All Alerts view.
- Admins assign corrective actions/tasks to technicians (Assign Actions -> technician Task view); technicians have their own dashboard and task list.
- Separate login flow for admin/technician (`security/admin-tech-login`) distinct from the public/customer-facing landing page.
- Growth/yield prediction is trained and served via a Python pipeline (`ml-analytics/`: Jupyter notebook, `predict_yield.py`, `rf_growth_model.joblib`) and surfaced through a `py` bridge under the shared web pages.
- Automation page exists to configure automated responses; History page keeps a record of past readings/actions.

## Capabilities and Constraints

- Roles are enforced via Firestore rules keyed on a `role` field on the user doc (`admin`, and implicitly `technician`); only admins can update/delete sensor readings and alert documents, and can write any user document (users can otherwise only write their own).
- Confirmed pages: Dashboard (Admin Overview), Real-Time Monitoring, Growth & Survival Predictions (analytics), Automation, All Alerts, Assign Actions, History, Users, Settings, Profile, plus technician Dashboard and My Tasks.
- Undecided/not yet confirmed: whether this deploys to a real operating farm or remains a capstone demonstration; specifics of the physical sensor hardware are not recorded here.

## Evidence on Hand

- Verified model metrics (from `ml-analytics/bantay_ulang_ml.ibynb` history): Random Forest R2 = 0.79 vs. MLR R2 = 0.27, with feature importances and 5-fold cross-validation. Treat this as the one concrete, citable proof point; do not invent additional benchmarks, testimonials, or customer names.
- No customer testimonials, press, or named farm case studies on hand — future work must not fabricate these.
- Logo assets available at repo root (`logo.png`, `logo-removebg-preview (1).png`).

## Product Principles

1. Predictions and alerts must always resolve to a clear, assignable action for a technician — a number or a red badge on its own is not enough.
2. Water-quality/growth signals are time-sensitive; the interface should make current state and recent trend obvious before historical depth.
3. Keep admin (oversight/configuration) and technician (execution) views distinct — don't force one role's workflow into the other's screen.
4. Only the verified RF model metrics are real evidence; never present placeholder benchmarks or invented farm results as if they were established.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established yet.
