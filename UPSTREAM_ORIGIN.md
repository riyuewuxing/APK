# Upstream Origin Notice

- **Upstream Repository**: https://github.com/chengzuopeng/stock-dashboard
- **Clone Date**: 2026-11-13
- **Stack**: React 19 + TypeScript + Vite + ECharts (`echarts-for-react`) + `framer-motion` + `lucide-react` + `stock-sdk`
- **Local Integration (Master Blueprint v4.0)**:
  - Stripped nested `.git` so `main` remains the sole repository authority.
  - Preserved all original open-source market views (`/`, `/heatmap`, `/rankings`, `/boards`, `/watchlist`, `/scanner`, `/eod-picker`, `/s/:code`, `/settings`).
  - Added read-only FastAPI local proxy (`/api`, `/vendor`, `/static` -> `http://127.0.0.1:8501`) in `vite.config.ts` and disabled external Grafana Faro telemetry unless explicitly opted in via `VITE_ENABLE_FARO=true`.
  - Integrated `/expert`, `/expert-radar`, and StockDetail PIT evidence cards backed strictly by `touzizhuanjia`'s read-only FastAPI engine (`research_only = true`, `execution_allowed = false`).

