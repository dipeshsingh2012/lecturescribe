# Project Specification & Execution Blueprint

**Thesis Title:** *Using Cross-Attention Temporal Transformers to Fuse High-Frequency Bedside Telemetry with Asynchronous EHR Records for Early Sepsis Prediction, Overcoming Multi-Rate Clinical Sampling Latency and Reducing False-Positive Alert Fatigue*

---

## 1. Executive Summary & Clinical Context

### The Core Problem

Sepsis is a life-threatening organ dysfunction caused by a dysregulated host response to infection. Every hour of delayed intervention (antibiotics, fluid resuscitation) increases mortality. Current hospital warning tools face two critical operational bottlenecks:

1. **The Multi-Rate Data Dilemma:** Clinical data moves at two vastly different speeds:
* **Bedside Telemetry:** Continuous, high-frequency signals (ECG, Heart Rate, Arterial BP, $\text{SpO}_2$) captured second-by-second or minute-by-minute.
* **EHR Records:** Discrete, sparse, asynchronous events (lactate, WBC, creatinine, IV fluids, medication administration) arriving irregularly hours apart.


2. **False-Positive Alert Fatigue:** Existing rule-based or tabular clinical decision support (CDS) algorithms generate excessive false alarms from isolated vital sign spikes (e.g., patient moving or in acute pain). Clinicians subconsciously silence or ignore these alarms, defeating the purpose of early detection.

### The Proposed Technical Solution

This project introduces a **Cross-Attention Temporal Transformer** architecture:

* High-frequency telemetry acts as the **Query ($Q$)**, while sparse, high-context EHR records act as the **Keys ($K$)** and **Values ($V$)**.
* The network queries historical lab and medication context dynamically, aligning multi-rate streams without brittle imputation or time-grid downsampling.
* The system pairs continuous physiological drift with clinical markers to suppress transient false positives and provide an early predictive horizon (4–6 hours prior to clinical shock).

```
Bedside Telemetry (Dense 1-min stream) ──> [Query  (Q)] ──┐
                                                          ├──> [Cross-Attention Fusion] ──> Calibrated Risk Trajectory
EHR Laboratory/Meds (Sparse, Async)    ──> [Key/Val(K,V)] ──┘             │
                                                                           └──> Cross-Attention Attribution (Explainability)

```

---

## 2. Professional & Academic Scoping

### Suitability for a 3-Semester M.Tech Runway

The project provides sufficient depth for a master’s thesis (e.g., Semesters 2, 3, and 4) due to inherent domain friction:

* Extracting and synchronizing multi-rate time-series from gigabyte-scale waveform and tabular datasets.
* Formulating continuous-time positional encodings without lookahead bias.
* Designing and executing extensive baseline benchmarking (GRU-D, GBDT, standard joint self-attention).
* Evaluating alert suppression metrics and lead-time clinical utility.

### Staff Engineer vs. Academic Scope

As a Staff Engineer in a Work-Integrated program, treating the thesis as a pure Jupyter notebook model misses your engineering strengths. Conversely, building a generic full-stack hospital management CRUD app wastes time on non-research code.

* **The Sweet Spot:** Build an **event-driven, real-time streaming Clinical Decision Support (CDS) platform**.
* Provide an algorithmic research core paired with a streaming ingestion engine, low-latency inference layer, and an interactive ICU bedside cockpit.

---

## 3. Production vs. Academic Decoupling Matrix

To protect intellectual property, honor corporate NDAs, and guarantee independent academic reproducibility, follow the **Conceptually Synergistic, Mechanically Decoupled** model.

| Dimension | Enterprise Production (e.g., HCA / SPOT) | Academic M.Tech Thesis |
| --- | --- | --- |
| **Data Source** | Internal proprietary patient records, enterprise lakes | **100% Open Data:** PhysioNet / MIMIC-IV & MIMIC-IV-Waveform |
| **Infrastructure** | Corporate laptops, internal VPCs, enterprise Git | Personal workstation, personal cloud GPUs, personal GitHub |
| **Core Method** | Rule-based heuristics / tabular GBDTs tuned for ops | Novel asymmetric Cross-Attention Temporal Transformer |
| **Data Ingestion** | Proprietary HL7 v2 pipes (Epic, Meditech, Cerner) | Canonical FHIR R4 schema abstraction & mock replay streamer |
| **Validation** | Operational hospital compliance, liability safety | Peer-reviewed benchmarks, ablation studies, statistical significance |
| **Citations** | Internal proprietary workflows (never disclosed) | Public literature on hospital sepsis tools (cited objectively) |

### The Three Operational Wisdom Injections

Leverage your real-world hospital background without using company code:

1. **Realistic Turnaround Latency ($\tau_{\text{delay}}$):** Model the realistic reporting delay between lab order draw and chart post rather than assuming instantaneous availability.
2. **Clinical Utility Metrics:** Evaluate models using **Alarms per Bed-Day** and **Workup-to-Detection Ratio** in addition to AUROC/AUPRC.
3. **FHIR R4 Ingestion Boundary:** Abstract vendor heterogeneity by designing the input pipeline to accept standardized FHIR R4 observation events.

---

## 4. End-to-End System Architecture

```
[MIMIC-IV Waveform & Clinical Storage]
                 │
                 ▼
[Replay & Streaming Ingestion Engine]
  ├── Continuous Telemetry Stream (1 Hz / 1-min windows via Redis Stream / WebSockets)
  └── Asynchronous Laboratory Events (Injected with simulated reporting lag tau)
                 │
                 ▼
[FHIR R4 Data Contract / Normalization Layer]
  └── Maps incoming events into canonical Pydantic FHIR Observation objects
                 │
                 ▼
[Inference Microservice (FastAPI / ONNX Runtime / PyTorch)]
  ├── Rolling Circular Buffer (High-frequency state)
  ├── Sparse Event Memory Queue (Historical labs/meds)
  ├── Cross-Attention Transformer Forward Pass (<15 ms)
  └── Dynamic Alert Suppression Engine (Cooldowns, Delta-triggers, Slope thresholds)
                 │
                 ▼ (WebSockets / SSE)
[ICU Bedside Clinical Cockpit (React / Vite / ECharts)]
  ├── Real-Time Multi-Rate Stream Visualizer (Waveforms + Lab drop pins)
  ├── Sepsis Risk Trajectory Curve (Threshold indicator at T - 4h / T - 6h)
  └── Cross-Attention Explainability Panel (Dynamic feature attribution breakdown)

```

---

## 5. Technical Implementation & Codebase Blueprint

Estimated codebase volume: **3,500 – 6,000 lines of modular Python/SQL and frontend code**.

```
sepsis-temporal-transformer/
├── configs/
│   └── model_config.yaml               # Hyperparameters, window sizes, delay distributions
├── data/
│   ├── sql/
│   │   └── sepsis3_cohort_mimic4.sql   # Sepsis-3 onset extraction (SOFA delta >= 2 + infection)
│   ├── extract/
│   │   └── wfdb_extractor.py           # Waveform signal extraction & SQI filtering
│   ├── normalization/
│   │   └── fhir_schema.py              # Canonical FHIR R4 Observation Pydantic models
│   └── alignment/
│       └── dual_rate_stream.py         # Multi-rate temporal alignment with causal lag injection
├── models/
│   ├── embeddings/
│   │   └── continuous_time.py          # Continuous-time positional encoding (Time2Vec / Fourier)
│   ├── attention/
│   │   └── cross_transformer.py        # Asymmetrical Cross-Attention Transformer blocks
│   └── baselines/
│       ├── grud.py                     # GRU-D baseline for irregularly sampled time-series
│       └── gbm_baseline.py             # LightGBM with windowed statistical aggregations
├── engine/
│   ├── replay_streamer.py              # Async event streamer simulating bedside monitor ticks
│   ├── alert_suppression.py            # Cooldown logic, threshold calibration, alarm filters
│   └── server.py                       # FastAPI WebSocket server for real-time inference
├── evaluation/
│   ├── metrics.py                      # PhysioNet Early Sepsis Utility, AUROC, AUPRC
│   └── alert_fatigue.py                # Alarms/bed-day, lead-time detection calculations
└── ui/
    ├── src/components/
    │   ├── TelemetryStream.tsx         # Canvas-based high-frequency waveform charts
    │   ├── RiskTrajectory.tsx          # 4-6 hour forward predictive risk horizon
    │   └── AttentionAttribution.tsx    # Attention weights rendered as explainability drivers
    └── package.json

```

---

## 6. Three-Semester Execution Timeline

```
Semester 1 (Phase 1): Cohort & Pipeline Foundation
├── Month 1: SQL extraction of Sepsis-3 cohorts on MIMIC-IV; initial signal filtering (WFDB).
└── Month 2: Multi-rate alignment algorithms, reporting latency simulation, baseline models (GBDT, GRU-D).

Semester 2 (Phase 2): Model Innovation & Experimentation
├── Month 3: Continuous-time encodings; custom PyTorch cross-attention architecture implementation.
├── Month 4: Model training runs, hyperparameter tuning, class-imbalance loss optimization.
└── Month 5: Rigorous ablation studies (cross-attention vs. joint-attention; latency sensitivity).

Semester 3 (Phase 3): Deployment Platform & Thesis Writing
├── Month 6: Alert suppression engine, ONNX model export, FastAPI streaming server.
├── Month 7: Interactive clinical cockpit frontend development; end-to-end integration demo.
└── Month 8: Comprehensive thesis manuscript drafting (60-90 pages), defense presentation prep.

```

---

## 7. Strategic Checklist Before You Start

* [ ] **Data Access:** Register on PhysioNet, complete the required CITI training ("Data or Specimens Only Research"), and gain credentialed access to **MIMIC-IV** and **MIMIC-IV-Waveform**.
* [ ] **Hardware Setup:** Ensure access to a local GPU with 16 GB+ VRAM or a cloud instance (A10G/T4) with 300–500 GB NVMe storage for waveform data.
* [ ] **Strict Air-Gap Verification:** Set up a clean GitHub repository on your personal machine using your personal email address. Confirm zero code or data overlaps with work environments.
* [ ] **Advisor Alignment:** Present the project to your academic guide focusing on the mathematical formulation of **multi-rate asynchronous temporal cross-attention** to establish early academic buy-in.