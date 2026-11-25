from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import mimetypes
from pathlib import Path
import time
from typing import Any
from urllib.parse import parse_qs, urlparse
import zipfile

DEFAULT_TOKEN = "e2e_demo_device_token_2026"
_SECRET = b"e2e_mock_hmac_secret_not_prod"


def _badge(claim_id: str = "CLM-DEMO-1") -> dict[str, Any]:
    return {
        "source_id": "DEMO_SYNTHETIC",
        "as_of": "2026-11-13",
        "confidence": "HIGH",
        "verification_status": "SUPPORTED",
        "crosscheck_status": "MATCHED",
        "claim_id": claim_id,
    }


def _governance() -> dict[str, Any]:
    return {
        "pit_cutoff_summary": "PIT 2026-11-13 · 云端自动化脱敏合成数据",
        "ledger_status": "SEALED_VERIFIED",
        "ledger_sha256_short": "demo1234",
        "crosscheck_summary": "双源核验一致",
        "execution_lock_label": "只读研究模式（禁止自动交易）",
        "research_only": True,
        "execution_allowed": False,
    }


def _sign_ticket(scope: str, token: str, ttl_sec: int = 3600) -> str:
    exp = int(time.time()) + ttl_sec
    mac = hmac.new(
        hashlib.sha256(_SECRET + token.encode("utf-8")).digest(),
        f"{scope}:{exp}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:24]
    return f"{exp}.{mac}"


def _verify_ticket(scope: str, ticket: str, token: str) -> bool:
    if "." not in ticket:
        return False
    exp_str, sig = ticket.split(".", 1)
    try:
        if int(exp_str) < int(time.time()):
            return False
    except ValueError:
        return False
    expected = hmac.new(
        hashlib.sha256(_SECRET + token.encode("utf-8")).digest(),
        f"{scope}:{exp_str}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:24]
    return hmac.compare_digest(sig, expected)


def build_bundle_zip(dist_dir: Path) -> dict[str, Any]:
    """Package dist_dir deterministically for real OTA download & unzip verification."""
    if not (dist_dir / "index.html").is_file():
        raise FileNotFoundError(f"dist index.html not found: {dist_dir}")
    files = sorted([p for p in dist_dir.rglob("*") if p.is_file()])
    digest_all = hashlib.sha256()
    buf = io.BytesIO()
    total_bytes = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for fp in files:
            rel = fp.relative_to(dist_dir).as_posix()
            raw = fp.read_bytes()
            total_bytes += len(raw)
            digest_all.update(rel.encode("utf-8") + b"\x00" + raw)
            zi = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            zf.writestr(zi, raw)
    zip_bytes = buf.getvalue()
    return {
        "bundle_version": "ota-e2e-20261115",
        "bundle_sha256": digest_all.hexdigest(),
        "zip_sha256": hashlib.sha256(zip_bytes).hexdigest(),
        "zip_bytes": len(zip_bytes),
        "file_count": len(files),
        "total_bytes": total_bytes,
        "generated_at": "2026-11-15T12:00:00Z",
        "zip_data": zip_bytes,
    }


def _workbench_payload() -> dict[str, Any]:
    return {
        "governance": _governance(),
        "priority_alerts": ["[DEMO] 600900 长江电力估值分位处于中性偏低区间"],
        "stock_account": {
            "account_id": "STK-ALIPAY-001",
            "account_name": "演示股票组合",
            "as_of": "2026-11-13",
            "reference_close_date": "2026-11-13",
            "book_status": "SEEDED_DEFAULT",
            "snapshot_id": "DEMO-STOCK-SNAPSHOT",
            "valuation_basis": "DEMO_REFERENCE_ONLY",
            "total_asset": 200000.0,
            "frozen_baseline_total": 195000.0,
            "change_pct": 2.56,
            "cash_amount": 50000.0,
            "cash_weight_pct": 25.0,
            "plan_b_total": 202000.0,
            "plan_b_diff": 2000.0,
            "plan_b_diff_pct": 1.0,
            "positions": [
                {
                    "symbol": "600900",
                    "name": "长江电力",
                    "quantity": 3000,
                    "close_price": 28.5,
                    "market_value": 85500.0,
                    "weight_pct": 42.75,
                    "action": "HOLD",
                    "action_label_zh": "持有观察",
                    "zero_position_test": "通过零仓位重置测试",
                    "trigger_summary": "股息率低于 3.2% 时下调评级",
                    "hypothesis_id": "HYP-DEMO-1",
                    "hypothesis_status": "ACTIVE",
                    "badge": _badge("CLM-DEMO-1"),
                },
                {
                    "symbol": "300476",
                    "name": "胜宏科技",
                    "quantity": 1500,
                    "close_price": 43.0,
                    "market_value": 64500.0,
                    "weight_pct": 32.25,
                    "action": "BUY",
                    "action_label_zh": "重点跟踪",
                    "zero_position_test": "赔率支持小仓位配置",
                    "trigger_summary": "毛利率跌破 22% 时复核逻辑",
                    "hypothesis_id": "HYP-DEMO-2",
                    "hypothesis_status": "ACTIVE",
                    "badge": _badge("CLM-DEMO-2"),
                },
            ],
            "hypothesis_reviews": [
                {"hypothesis_id": "HYP-DEMO-1", "symbol": "600900", "status": "ACTIVE", "summary": "水电现金流稳定"}
            ],
            "badge": _badge(),
        },
        "fund_account": {
            "account_id": "FND-TIANTIAN-002",
            "account_name": "演示基金组合",
            "as_of": "2026-11-13",
            "pending_as_of": "2026-11-13",
            "book_status": "FROZEN_HISTORICAL",
            "snapshot_id": "DEMO-FUND-SNAPSHOT",
            "total_asset": 100000.0,
            "daily_pnl": 650.0,
            "holding_pnl": 4800.0,
            "pending_redemption_total_cny": 0.0,
            "redemption_state_chain": "无在途赎回",
            "holdings": [
                {
                    "fund_code": "018956",
                    "fund_name": "中航AI主题演示A",
                    "asset_value": 60000.0,
                    "daily_pnl": 420.0,
                    "holding_pnl": 3200.0,
                    "weight_pct": 60.0,
                    "risk_bucket": "卫星成长",
                    "pending_redemption_cny": 0.0,
                    "badge": _badge("CLM-DEMO-3"),
                }
            ],
            "risk_buckets": [
                {
                    "bucket_name": "稳健底仓",
                    "current_weight_pct": 40.0,
                    "post_redemption_weight_pct": 40.0,
                    "band_min_pct": 30.0,
                    "band_max_pct": 55.0,
                    "band_display": "30% - 55%",
                    "status": "NORMAL",
                },
                {
                    "bucket_name": "卫星成长",
                    "current_weight_pct": 60.0,
                    "post_redemption_weight_pct": 60.0,
                    "band_min_pct": 40.0,
                    "band_max_pct": 65.0,
                    "band_display": "40% - 65%",
                    "status": "NORMAL",
                },
            ],
            "pending_orders": [],
            "badge": _badge(),
        },
        "registered_accounts": ["STK-ALIPAY-001", "FND-TIANTIAN-002"],
        "research_only": True,
        "execution_allowed": False,
    }


def _research_payload(subject_id: str) -> dict[str, Any]:
    clean = subject_id.upper()
    asset_type = "STOCK"
    name = f"演示标的 {clean}"
    action = "HOLD"
    label = "持有观察"
    if clean in {"510300", "510500"}:
        asset_type, name = "INDEX_ETF", "沪深300ETF(演示)"
    elif clean == "560980":
        asset_type, name = "ACTIVE_ETF", "主动增强ETF(演示)"
    elif clean == "018956":
        asset_type, name = "PUBLIC_FUND", "中航AI混合(演示)"
    elif clean == "600900":
        name = "长江电力"
    elif clean == "300476":
        name, action, label = "胜宏科技", "BUY", "重点研究"
    elif "UNKNOWN" in clean:
        action, label = "INSUFFICIENT_EVIDENCE", "证据不足"

    clusters = [
        ("VALUATION_AND_ODDS", 0.65, "估值与赔率位于中位数下方"),
        ("FUNDAMENTAL_AND_QUALITY", 0.72, "自由现金流与 ROE 保持稳健"),
        ("PRICE_TREND_AND_FLOW", 0.35, "量价处于温和放量区间"),
        ("INDUSTRY_AND_CATALYST", 0.48, "行业景气度边际改善"),
        ("PORTFOLIO_AND_OPPORTUNITY_COST", 0.40, "组合相关性低，具备分散收益"),
    ]
    bars = [
        {
            "time": f"2026-10-{15 + i:02d}",
            "open": round(27.0 + i * 0.1, 2),
            "high": round(27.4 + i * 0.1, 2),
            "low": round(26.8 + i * 0.1, 2),
            "close": round(27.2 + i * 0.1, 2),
            "volume": 100000 + i * 2500,
        }
        for i in range(15)
    ]
    return {
        "subject_id": subject_id,
        "subject_name": name,
        "asset_type": asset_type,
        "as_of": "2026-11-13",
        "account_snapshot_id": "DEMO-STOCK-SNAPSHOT",
        "account_snapshot_status": "SEEDED_DEFAULT",
        "decision_packet": {
            "subject_id": subject_id,
            "subject_name": name,
            "asset_type": asset_type,
            "as_of": "2026-11-13",
            "currently_held": clean in {"600900", "300476", "018956"},
            "action": "INSUFFICIENT_EVIDENCE" if action == "INSUFFICIENT_EVIDENCE" else "WAIT",
            "action_label_zh": "证据不足（模拟）" if action == "INSUFFICIENT_EVIDENCE" else "等待（模拟）",
            "research_action": action,
            "admission_state": "NOT_ADMITTED",
            "supporting_clusters_count": 4,
            "contradicting_clusters_count": 1,
            "unknown_clusters_count": 0,
            "composite_conviction_score": 0.68,
            "red_flag_blockers": [],
            "unresolved_gaps": [] if action != "INSUFFICIENT_EVIDENCE" else ["缺少最新季报现金流细节"],
            "supporting_reasons": ["[FACT] 现金流覆盖率良好", "[FACT] 历史分红记录连续稳定"],
            "counter_reasons": ["[RISK] 原材料/利率波动可能压缩短期利差"],
            "change_triggers": ["自由现金流连续两季转负即下调建议"],
            "cluster_votes": [
                {
                    "cluster": cid,
                    "net_direction": score,
                    "deduped_score": score,
                    "raw_indicator_count": 2,
                    "effective_independent_votes": 2.0,
                    "collinearity_suppressed_count": 0,
                    "has_red_flag": False,
                    "has_conflict": False,
                    "primary_evidence_summary": desc,
                    "indicators": [
                        {
                            "indicator_id": f"IND-{idx}",
                            "name": f"正交指标 {idx + 1}",
                            "cluster": cid,
                            "direction": 1,
                            "strength": score,
                            "value_display": "正常",
                            "summary": desc,
                            "is_red_flag_blocker": False,
                            "claim_kind": "FACT",
                            "badge": _badge(),
                        }
                    ],
                }
                for idx, (cid, score, desc) in enumerate(clusters)
            ],
            "research_only": True,
            "execution_allowed": False,
        },
        "turnaround_report": {
            "subject_id": subject_id,
            "as_of": "2026-11-13",
            "classification": "QUALITY_COMPOUNDER",
            "turnaround_score": 72.5,
            "trap_risk_score": 18.0,
            "piotroski_f_score": 7,
            "altman_z_score": 3.45,
            "beneish_m_score": -2.42,
            "engine_provider": "ValueInvest-Demo",
            "dupont": {
                "net_profit_margin_pct": 18.4,
                "asset_turnover": 0.62,
                "equity_multiplier": 1.75,
                "computed_roe_pct": 19.96,
                "driver_diagnosis": "高净利率驱动型复合增长",
            },
            "reverse_dcf": {
                "market_cap": 6800.0,
                "normalized_fcf": 360.0,
                "discount_rate": 0.085,
                "terminal_growth": 0.025,
                "implied_5y_cagr_pct": 6.4,
                "safety_margin_assessment": "隐含增长要求温和",
            },
            "red_flags": [],
            "turnaround_drivers": ["产能利用率稳步回升"],
            "emitted_indicators": [],
        },
        "asset_specific_metrics": {"研究资产分类": asset_type, "估值分位": "38%", "研究来源": "E2E脱敏"},
        "opportunity_cost_matrix": [
            {
                "alternative_id": "510300",
                "alternative_name": "沪深300ETF(基准)",
                "alternative_kind": "INDEX_ETF",
                "thesis_quality": "HIGH",
                "evidence_confidence": "HIGH",
                "zero_position_test": "通过对比基准测试",
                "decision_eligible": True,
                "candidate_advantages": ["自由现金流更高"],
                "alternative_advantages": ["单标的波动风险更低"],
                "shared_unknowns": ["宏观需求节奏"],
                "governance_reasons": ["双通道交叉校验完成"],
            }
        ],
        "portfolio_correlation": {
            "as_of": "2026-11-13",
            "symbols": ["600900", "300476"],
            "names": {"600900": "长江电力", "300476": "胜宏科技"},
            "target_symbol": subject_id,
            "avg_correlation_to_portfolio": 0.24,
            "max_correlated_holding": {"symbol": "600900", "name": "长江电力", "correlation": 0.24},
            "target_min_vol_weight_pct": 58.0,
            "target_equal_weight_pct": 50.0,
            "weights": {"600900": 0.58, "300476": 0.42},
            "equal_weight_baseline": {"600900": 0.5, "300476": 0.5},
            "correlation_matrix": {
                "600900": {"600900": 1.0, "300476": 0.24},
                "300476": {"600900": 0.24, "300476": 1.0},
            },
            "optimized_metrics": {"sharpe": 1.42, "volatility_pct": 14.2},
            "equal_weight_metrics": {"sharpe": 1.18, "volatility_pct": 16.5},
            "status": "OK",
            "research_only": True,
            "execution_allowed": False,
        },
        "kline_bars": bars,
        "kline_markers": [
            {"time": bars[-3]["time"], "position": "belowBar", "color": "#22c55e", "shape": "arrowUp", "text": "DEMO"}
        ],
        "cash_execution_summary": ({
            "status": "SCENARIO_ONLY" if clean == "600900" else "BLOCKED",
            "reason": "[DEMO] 合成UI测试，非真实成交" if clean == "600900" else "[DEMO] 缺少完整历史交易状态",
            "execution_gate": "PASS" if clean == "600900" else "BLOCK",
            "observation_count": 100,
            "sample_start": "2026-06-01",
            "sample_end": "2026-11-13",
            "data_cutoff": "2026-11-13",
            "warnings": ["SYNTHETIC_UI_FIXTURE_ONLY"],
            "historical_vintage_verified": False,
            "research_only": True,
            "execution_allowed": False,
            **({"initial_cash_cny": 1000000, "total_return_pct": 1.2,
                "max_drawdown_pct": -2.0, "filled_order_count": 1,
                "blocked_order_count": 0, "closed_trade_count": 0,
                "closed_trade_win_rate_pct": None, "closed_trade_net_pnl_cny": 0.0,
                "open_position_count": 1} if clean == "600900" else {}),
        } if asset_type == "STOCK" else None),
        "backtest_summary": {
            "strategy_name": "模拟 E2E 研究标尺（非实际撮合）",
            "total_return_1x_pct": 14.8,
            "total_return_2x_pct": 11.6,
            "max_drawdown_1x_pct": -6.4,
            "sharpe_1x": 1.35,
            "win_rate_pct": None,
            "trade_count": None,
            "statistics_basis": "ADJUSTED_PRICE_RESEARCH_BENCHMARK",
            "positive_day_rate_pct": 58.3,
            "position_change_count": 12,
            "observation_count": len(bars),
            "underwater_dates": [b["time"] for b in bars],
            "underwater_drawdowns_pct": [-round((i % 4) * 1.1, 2) for i in range(len(bars))],
            "warnings": [],
        },
        "audit_claims": [
            {
                "claim_id": "CLM-DEMO-1",
                "subject_ids": [subject_id],
                "domain": "FUNDAMENTAL",
                "kind": "FACT",
                "verification_status": "SUPPORTED",
                "confidence": "HIGH",
                "claim_text": "云端 E2E 合成核验通过",
                "source_ids": ["DEMO_SYNTHETIC"],
            }
        ],
        "header_badge": _badge(),
        "research_only": True,
        "execution_allowed": False,
    }


def _radar_payload() -> dict[str, Any]:
    return {
        "as_of": "2026-11-13",
        "turnaround_candidates": [
            {
                "symbol": "600900",
                "name": "长江电力",
                "security_id": "600900",
                "primary_lens": "VALUE_QUALITY",
                "research_priority_score": 82.0,
                "ranking_semantics": "RESEARCH_PRIORITY_ONLY",
                "state": "QUALIFIED",
                "turnaround_classification": "QUALITY_COMPOUNDER",
                "turnaround_score": 76.0,
                "trap_risk_score": 15.0,
                "piotroski_f_score": 8,
                "altman_z_score": 3.5,
                "beneish_m_score": -2.6,
                "red_flag_titles": [],
                "summary": "合成研究优先级示例条目",
                "badge": _badge(),
            }
        ],
        "value_trap_warnings": [],
        "stock_discovery": [],
        "index_etfs": [
            {
                "listed_security_id": "510300",
                "symbol": "510300",
                "name": "沪深300ETF(演示)",
                "etf_subtype": "INDEX_ETF",
                "benchmark_or_index": "沪深300指数",
                "market_price": 4.12,
                "reference_value": 4.115,
                "premium_discount_pct": 0.12,
                "tracking_error_or_excess": "年化跟踪误差 0.32%",
                "liquidity_spread_bps": 2.4,
                "fee_bps": 15,
                "lens_score": 84.0,
                "quality_status": "HEALTHY",
                "summary": "低费率宽基指数代表",
                "badge": _badge(),
            }
        ],
        "active_etfs": [
            {
                "listed_security_id": "511090_ACT",
                "symbol": "511090_ACT",
                "name": "主动增强红利策略ETF(示例)",
                "etf_subtype": "ACTIVE_ETF",
                "benchmark_or_index": "自主增强基准",
                "market_price": 1.18,
                "reference_value": 1.178,
                "premium_discount_pct": 0.17,
                "tracking_error_or_excess": "滚动超额 +3.4%",
                "liquidity_spread_bps": 8.0,
                "fee_bps": 50,
                "lens_score": 74.0,
                "quality_status": "WATCH",
                "summary": "主动管理 ETF 语义示例",
                "badge": _badge(),
            }
        ],
        "public_funds": [
            {
                "fund_code": "018956",
                "fund_name": "中航AI混合(演示)",
                "category": "ACTIVE_EQUITY",
                "manager_tenure_years": 3.5,
                "rolling_excess_1y_pct": 4.2,
                "max_drawdown_recovery_days": 45,
                "style_consistency": "科技成长一致",
                "fee_rate_pct": 1.2,
                "subscription_state": "开放申赎",
                "lens_score": 78.0,
                "summary": "公募基金专属研究口径",
                "badge": _badge(),
            }
        ],
        "snapshot_store_count": 4,
        "research_only": True,
        "execution_allowed": False,
    }


def _quantstats_payload() -> dict[str, Any]:
    dates = [f"2026-10-{10 + i:02d}" for i in range(15)]
    return {
        "account_id": "STK-ALIPAY-001",
        "account_name": "演示股票组合",
        "as_of": "2026-11-13",
        "total_asset_cny": 200000.0,
        "holding_count": 2,
        "account_snapshot_id": "DEMO-STOCK-SNAPSHOT",
        "performance_basis": "SYNTHETIC_UI_FIXTURE_ONLY",
        "benchmark_label": "沪深300(合成)",
        "quantstats_version": "0.0.64-demo",
        "metrics": {
            "sharpe": 1.42,
            "sortino": 1.85,
            "max_drawdown_pct": -5.8,
            "calmar": 2.45,
            "win_rate_pct": 60.0,
            "tail_ratio": 1.32,
            "var_95_pct": -1.45,
            "cvar_95_pct": -1.92,
            "cagr_pct": 14.2,
            "volatility_pct": 12.1,
            "total_return_pct": 11.4,
            "benchmark_total_return_pct": 6.2,
            "excess_return_pct": 5.2,
            "benchmark_sharpe": 0.88,
            "benchmark_max_drawdown_pct": -8.4,
        },
        "series": {
            "dates": dates,
            "strategy_cum_pct": [round(i * 0.75, 2) for i in range(15)],
            "benchmark_cum_pct": [round(i * 0.42, 2) for i in range(15)],
            "drawdown_pct": [-round((i % 3) * 0.8, 2) for i in range(15)],
        },
        "pypfopt_summary": _research_payload("600900")["portfolio_correlation"],
        "manifest": {"demo": True},
        "html_path": "/api/quantstats/html",
        "research_only": True,
        "execution_allowed": False,
    }


def _audit_payload() -> dict[str, Any]:
    return {
        "governance": _governance(),
        "ledger_id": "LEDGER-E2E-DEMO",
        "ledger_as_of": "2026-11-13",
        "raw_ledger_sha256": "demo" * 16,
        "manifest_ledger_match": True,
        "internal_seal_match": True,
        "model_rehash_match": True,
        "hash_note": "脱敏合成账本校验一致",
        "graph_id": "GRAPH-DEMO-1",
        "graph_node_count": 6,
        "graph_relation_count": 5,
        "graph_conflicts": [],
        "graph_unknowns": [],
        "status_counts": {"SUPPORTED": 4},
        "kind_counts": {"FACT": 4},
        "claims": _research_payload("600900")["audit_claims"],
        "gap_items": [],
        "conflict_rows": [],
        "snapshots": [
            {
                "dataset_id": "demo_quotes",
                "snapshot_id": "SNP-001",
                "dataset_kind": "MARKET",
                "research_as_of": "2026-11-13",
                "row_count": 20,
                "content_sha256": "demo" * 16,
                "verified": True,
            }
        ],
        "source_health": [
            {
                "source_name": "DEMO_LOCAL",
                "category": "SYNTHETIC",
                "status": "HEALTHY",
                "crosscheck_mode": "PIT",
                "detail": "E2E 合成数据源正常",
            }
        ],
        "research_only": True,
        "execution_allowed": False,
    }


def _eod_regime_payload() -> dict[str, Any]:
    return {
        "regime": "GREEN",
        "trade_date": "2026-11-17",
        "as_of": "2026-11-17T14:45:00+08:00",
        "data_available": True,
        "advance_ratio_pct": 55.2,
        "broken_board_rate_pct": 22.4,
        "limit_up_count": 62,
        "broken_board_count": 18,
        "limit_down_count": 4,
        "max_streak_height": 6,
        "note": "",
        "source": "e2e_mock",
        "research_only": True,
        "execution_allowed": False,
    }


def _eod_analyze_payload() -> dict[str, Any]:
    return {
        "items": [
            {
                "code": "sz300476",
                "name": "胜宏科技",
                "pick_price": 45.2,
                "change_percent": 3.85,
                "structure_factors": {
                    "code": "sz300476",
                    "tail_30m_return_pct": 1.42,
                    "tail_30m_amount_share_pct": 24.6,
                    "intraday_drawback_pct": 1.2,
                    "timeline_above_avg_ratio": 88.5,
                    "chip_profit_ratio_approx": 62.3,
                    "overhead_pressure_pct": 27.7,
                    "chip_known_coverage_pct": 90.0,
                    "chip_unknown_pct": 10.0,
                    "chip_break_even_pct": 0.0,
                    "chip_bin_sensitivity_pp": 3.0,
                    "timeline_average_basis": "MINUTE_CLOSE_VOLUME_WEIGHTED_APPROX",
                    "main_net_inflow_10k": 3200.5,
                    "board_resonance": 1.78,
                    "chip_estimate_basis": "PRICE_BINNED_DAILY_TURNOVER_APPROX",
                    "available": True,
                    "unavailable_reasons": [],
                },
                "vetting": {
                    "code": "300476",
                    "name": "胜宏科技",
                    "vetting_status": "CLEAN",
                    "flags": [],
                    "as_of": "2026-11-17T14:45:00+08:00",
                    "research_route": "/expert?subject=300476",
                    "disclaimer": "CANDIDATE_VETTING_ONLY",
                    "research_only": True,
                    "execution_allowed": False,
                },
            }
        ],
        "count": 1,
        "as_of": "2026-11-17T14:45:00+08:00",
        "disclaimer": "CANDIDATE_VETTING_ONLY",
        "research_only": True,
        "execution_allowed": False,
    }


def _eod_journal_payload() -> dict[str, Any]:
    return {
        "snapshots": [
            {
                "journal_version": 2,
                "record_basis": "CLIENT_REFERENCE_ONLY",
                "recorded_at": "2026-11-13T14:50:13+08:00",
                "snapshot_id": "2026-11-13_default",
                "trade_date": "2026-11-13",
                "created_at": "2026-11-13T14:50:12+08:00",
                "scheme_name": "[DEMO] 参考价观察",
                "market_regime": "GREEN",
                "candidates": [
                    {
                        "code": "300476",
                        "name": "胜宏科技",
                        "pick_price": 45.2,
                        "change_percent": 3.85,
                        "tail_30m_return_pct": 1.42,
                        "tail_30m_amount_share_pct": 24.6,
                        "vetting_status": "CLEAN",
                        "settlement": {
                            "price_basis": "RAW_REFERENCE_GROSS",
                            "t1_date": "2026-11-16",
                            "t1_open_premium_pct": 0.85,
                            "t1_high_return_pct": 2.3,
                            "t1_close_return_pct": 1.6,
                            "t3_date": None,
                            "t3_close_return_pct": None,
                            "status": "PARTIAL",
                        },
                    }
                ],
                "research_only": True,
                "execution_allowed": False,
            }
        ],
        "stats": {
            "generated_at": "2026-11-17T14:45:00+08:00",
            "snapshot_count": 1,
            "candidate_count": 1,
            "schemes": [
                {
                    "scheme_name": "[DEMO] 参考价观察",
                    "overall": {
                        "sample_count": 1,
                        "settled_count": 1,
                        "statistics_basis": "RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE",
                        "legacy_excluded_count": 0,
                        "t1_open_observation_count": 1,
                        "t1_close_observation_count": 1,
                        "t3_close_observation_count": 0,
                        "t1_open_win_rate_pct": 100.0,
                        "t1_close_win_rate_pct": 100.0,
                        "t3_close_win_rate_pct": None,
                        "avg_open_premium_pct": 0.85,
                        "profit_loss_ratio": None,
                    },
                    "by_regime": {
                        "GREEN": {
                            "sample_count": 1,
                            "settled_count": 1,
                        "statistics_basis": "RAW_REFERENCE_GROSS_NOT_TRADE_WIN_RATE",
                        "legacy_excluded_count": 0,
                        "t1_open_observation_count": 1,
                        "t1_close_observation_count": 1,
                        "t3_close_observation_count": 0,
                            "t1_open_win_rate_pct": 100.0,
                            "t1_close_win_rate_pct": 100.0,
                            "t3_close_win_rate_pct": None,
                            "avg_open_premium_pct": 0.85,
                            "profit_loss_ratio": None,
                        }
                    },
                }
            ],
            "research_only": True,
            "execution_allowed": False,
        },
        "journal_path": "e2e_mock_eod_journal",
        "research_only": True,
        "execution_allowed": False,
    }


def _portfolio_xray_payload(account_id: str = "ALL") -> dict[str, Any] | None:
    acct = (account_id or "ALL").strip().upper()
    if acct not in {"ALL", "STK-ALIPAY-001", "FND-TIANTIAN-002"}:
        return None

    if acct == "STK-ALIPAY-001":
        return {
            "account_id": "STK-ALIPAY-001",
            "account_label": "支付宝股票 (STK-ALIPAY-001)",
            "as_of": "2026-11-17",
            "include_amounts": False,
            "total_equity_cny": None,
            "unattributed_bucket_id": "UNATTRIBUTED_FUND_RESIDUAL",
            "coverage_summary": {
                "direct_stock_weight_pct": 86.01,
                "indirect_disclosed_stock_weight_pct": 0.0,
                "total_disclosed_equity_weight_pct": 86.01,
                "cash_and_money_fund_weight_pct": 13.99,
                "unattributed_fund_residual_pct": 0.0,
                "max_staleness_days": None,
                "disclosed_fund_count": 0,
                "total_fund_count": 0,
                "data_gap_notes": ["当前仅展示直持股票账户口径，无基金季报滞后。"],
            },
            "top_underlying_exposures": [
                {
                    "symbol": "600900",
                    "name": "长江电力",
                    "sector": "电力",
                    "total_weight_pct": 19.78,
                    "direct_weight_pct": 19.78,
                    "indirect_weight_pct": 0.0,
                    "holder_count": 1,
                    "is_direct_held": True,
                    "research_route": "/expert?symbol=sh600900",
                    "breakdown_text": "直持 19.78%",
                    "contributions": [],
                },
                {
                    "symbol": "601138",
                    "name": "工业富联",
                    "sector": "消费电子",
                    "total_weight_pct": 19.32,
                    "direct_weight_pct": 19.32,
                    "indirect_weight_pct": 0.0,
                    "holder_count": 1,
                    "is_direct_held": True,
                    "research_route": "/expert?symbol=sh601138",
                    "breakdown_text": "直持 19.32%",
                    "contributions": [],
                },
            ],
            "overlap_alerts": [
                {
                    "symbol": "600900",
                    "name": "长江电力",
                    "sector": "电力",
                    "alert_type": "CONCENTRATED_SINGLE",
                    "holder_count": 1,
                    "total_weight_pct": 19.78,
                    "direct_weight_pct": 19.78,
                    "indirect_weight_pct": 0.0,
                    "holders_summary": "直持 19.78%",
                    "research_route": "/expert?symbol=sh600900",
                }
            ],
            "sector_exposures": [
                {
                    "sector": "电力",
                    "total_weight_pct": 19.78,
                    "direct_weight_pct": 19.78,
                    "indirect_weight_pct": 0.0,
                    "underlying_count": 1,
                    "top_symbols": ["长江电力(19.78%)"],
                },
                {
                    "sector": "消费电子",
                    "total_weight_pct": 19.32,
                    "direct_weight_pct": 19.32,
                    "indirect_weight_pct": 0.0,
                    "underlying_count": 1,
                    "top_symbols": ["工业富联(19.32%)"],
                },
            ],
            "fund_disclosures": [],
            "lookthrough_exposures": [],
            "warnings": [],
            "research_only": True,
            "execution_allowed": False,
        }

    is_fund_only = acct == "FND-TIANTIAN-002"
    direct_wt = 0.0 if is_fund_only else 3.56
    indirect_wt = 10.25 if is_fund_only else 9.83
    return {
        "account_id": acct,
        "account_label": "天天基金 (FND-TIANTIAN-002)" if is_fund_only else "全账户联合穿透 (STK + FND)",
        "as_of": "2026-11-06",
        "include_amounts": False,
        "total_equity_cny": None,
        "unattributed_bucket_id": "UNATTRIBUTED_FUND_RESIDUAL",
        "coverage_summary": {
            "direct_stock_weight_pct": direct_wt,
            "indirect_disclosed_stock_weight_pct": indirect_wt,
            "total_disclosed_equity_weight_pct": round(direct_wt + indirect_wt, 2),
            "cash_and_money_fund_weight_pct": 13.63 if is_fund_only else 13.64,
            "unattributed_fund_residual_pct": 76.12 if is_fund_only else 72.97,
            "max_staleness_days": 37,
            "disclosed_fund_count": 4,
            "total_fund_count": 6,
            "data_gap_notes": [
                "部分 ETF 联接基金仅披露直持股票部分，其余目标 ETF 仓位严格归入 UNATTRIBUTED_FUND_RESIDUAL（严禁插值反推）。"
            ],
        },
        "top_underlying_exposures": [
            {
                "symbol": "601138",
                "name": "工业富联",
                "sector": "消费电子",
                "total_weight_pct": 0.56 if is_fund_only else 1.36,
                "direct_weight_pct": 0.0 if is_fund_only else 0.8,
                "indirect_weight_pct": 0.56 if is_fund_only else 0.56,
                "holder_count": 1 if is_fund_only else 2,
                "is_direct_held": not is_fund_only,
                "research_route": "/expert?symbol=sh601138",
                "breakdown_text": (
                    "通过 018956 间接持有 0.56% (占基 5.80%)"
                    if is_fund_only
                    else "直持 0.80% + 通过 018956 间接持有 0.56% (占基 5.80%)"
                ),
                "contributions": [],
            },
            {
                "symbol": "300308",
                "name": "中际旭创",
                "sector": "通信设备",
                "total_weight_pct": 1.18,
                "direct_weight_pct": 0.0,
                "indirect_weight_pct": 1.18,
                "holder_count": 4,
                "is_direct_held": False,
                "research_route": "/expert?symbol=sz300308",
                "breakdown_text": "通过 018956 间接持有 0.93% + 通过 008528 间接持有 0.18% + 通过 000297 间接持有 0.06%",
                "contributions": [],
            },
        ],
        "overlap_alerts": [
            {
                "symbol": "601138",
                "name": "工业富联",
                "sector": "消费电子",
                "alert_type": "MULTI_HOLDER",
                "holder_count": 2,
                "total_weight_pct": 1.36,
                "direct_weight_pct": 0.0 if is_fund_only else 0.8,
                "indirect_weight_pct": 0.56,
                "holders_summary": "直持 0.80% + 通过 018956 间接持有 0.56%",
                "research_route": "/expert?symbol=sh601138",
            },
            {
                "symbol": "300308",
                "name": "中际旭创",
                "sector": "通信设备",
                "alert_type": "MULTI_HOLDER",
                "holder_count": 4,
                "total_weight_pct": 1.18,
                "direct_weight_pct": 0.0,
                "indirect_weight_pct": 1.18,
                "holders_summary": "跨 4 只基金共同重仓 1.18%",
                "research_route": "/expert?symbol=sz300308",
            },
        ],
        "sector_exposures": [
            {
                "sector": "消费电子",
                "total_weight_pct": 1.36,
                "direct_weight_pct": 0.0 if is_fund_only else 0.8,
                "indirect_weight_pct": 0.56,
                "underlying_count": 2,
                "top_symbols": ["工业富联(1.36%)"],
            },
            {
                "sector": "通信设备",
                "total_weight_pct": 2.45,
                "direct_weight_pct": 0.0,
                "indirect_weight_pct": 2.45,
                "underlying_count": 3,
                "top_symbols": ["中际旭创(1.18%)"],
            },
        ],
        "fund_disclosures": [
            {
                "fund_code": "018956",
                "fund_name": "中航机遇领航混合发起A",
                "account_id": "FND-TIANTIAN-002",
                "portfolio_weight_pct": 9.38,
                "asset_class": "FUND",
                "holdings_report_date": "2026-09-30",
                "staleness_days": 37,
                "disclosed_coverage_pct": 72.44,
                "unattributed_residual_pct": 27.56,
                "top_holdings_count": 13,
                "status": "DISCLOSED",
                "source": "mock_em",
                "note": "已披露 13 只持仓股覆盖 72.44%，未披露 27.56% 保留在 UNATTRIBUTED_FUND_RESIDUAL。",
            },
            {
                "fund_code": "022460",
                "fund_name": "易方达中证A500ETF联接C",
                "account_id": "FND-TIANTIAN-002",
                "portfolio_weight_pct": 39.31,
                "asset_class": "FUND",
                "holdings_report_date": "2026-09-30",
                "staleness_days": 37,
                "disclosed_coverage_pct": 0.93,
                "unattributed_residual_pct": 99.07,
                "top_holdings_count": 10,
                "status": "LOW_COVERAGE_FEEDER",
                "source": "mock_em",
                "note": "ETF联接基金季报仅直持股票 0.93%，其余目标ETF份额归入 UNATTRIBUTED_FUND_RESIDUAL。",
            },
            {
                "fund_code": "004861",
                "fund_name": "泰康现金管家货币A",
                "account_id": "FND-TIANTIAN-002",
                "portfolio_weight_pct": 13.06,
                "asset_class": "MONEY_FUND",
                "holdings_report_date": None,
                "staleness_days": None,
                "disclosed_coverage_pct": 0.0,
                "unattributed_residual_pct": 0.0,
                "top_holdings_count": 0,
                "status": "MONEY_FUND_CASH_EQUIV",
                "source": "account_snapshot",
                "note": "货币基金计入组合货币现金等效垫，不穿透股票明细。",
            },
        ],
        "lookthrough_exposures": [],
        "warnings": [],
        "research_only": True,
        "execution_allowed": False,
    }


def _minesweeper_payload(subject_id: str, asset_type_hint: str = "") -> dict[str, Any]:
    clean = subject_id.strip().upper().removeprefix("SH").removeprefix("SZ").removeprefix("BJ")
    hint = asset_type_hint.strip().upper()
    is_non_stock = hint in {"FUND", "INDEX_ETF", "ACTIVE_ETF", "INDEX"} or clean.startswith(("51", "56", "58", "15", "02", "004", "11"))
    if is_non_stock:
        asset_type = hint if hint in {"FUND", "INDEX_ETF", "ACTIVE_ETF", "INDEX"} else (
            "INDEX_ETF" if clean.startswith(("51", "56", "58", "15")) else "FUND"
        )
        return {
            "symbol": clean,
            "subject_id": clean,
            "subject_name": f"示例非股资产 {clean}",
            "asset_type": asset_type,
            "asset_semantic_isolated": True,
            "as_of": "2026-11-18",
            "report_date": None,
            "report_name": None,
            "overall_status": "NOT_APPLICABLE",
            "risk_score": None,
            "rules_total": 0,
            "red_flag_count": 0,
            "warn_count": 0,
            "unknown_count": 0,
            "pass_count": 0,
            "categories": [],
            "rules": [],
            "recent_disclosures": [],
            "pledge_ratio_pct": None,
            "restricted_unlock_pct": None,
            "data_sources": {"semantic_guard": "asset_isolated"},
            "notice": "资产语义隔离生效：公募基金/ETF 严禁套用公司三表财务排雷规则。",
            "research_only": True,
            "execution_allowed": False,
        }

    cats = [
        ("BALANCE_SHEET", "资产负债表结构与偿债", 1, 12),
        ("PROFIT_CASHFLOW", "利润质量与现金流匹配", 13, 22),
        ("GOVERNANCE_DISCLOSURE", "治理结构与近90天公告", 23, 30),
    ]
    rules: list[dict[str, Any]] = []
    for cat_key, cat_zh, start_i, end_i in cats:
        for idx in range(start_i, end_i + 1):
            rule_id = f"FM-{idx:02d}"
            status = "RED_FLAG" if rule_id == "FM-05" else ("WARN" if rule_id == "FM-18" else "PASS")
            rules.append(
                {
                    "rule_id": rule_id,
                    "category": cat_key,
                    "category_zh": cat_zh,
                    "title_zh": f"合成排雷规则 {rule_id}",
                    "status": status,
                    "metric_display": "示例值 62.4%" if status == "RED_FLAG" else ("示例值 1.15" if status == "WARN" else "正常"),
                    "threshold_desc": "合成验证阈值",
                    "detail": f"{rule_id} 合成脱敏体检明细（用于端到端渲染与折叠/展开校验）。",
                    "missing_fields": [],
                    "evidence_source": "mock_e2e_sanitized",
                }
            )
    return {
        "symbol": clean,
        "subject_id": clean,
        "subject_name": "示例电力" if clean == "600900" else f"示例股票 {clean}",
        "asset_type": "STOCK",
        "asset_semantic_isolated": False,
        "as_of": "2026-11-18",
        "report_date": "2026-09-30",
        "report_name": "2026年三季报",
        "overall_status": "RED_FLAG",
        "risk_score": 15,
        "rules_total": 30,
        "red_flag_count": 1,
        "warn_count": 1,
        "unknown_count": 0,
        "pass_count": 28,
        "categories": [
            {"category": "BALANCE_SHEET", "label": "资产负债表结构与偿债", "total": 12, "red_flag": 1, "warn": 0, "unknown": 0, "pass": 11},
            {"category": "PROFIT_CASHFLOW", "label": "利润质量与现金流匹配", "total": 10, "red_flag": 0, "warn": 1, "unknown": 0, "pass": 9},
            {"category": "GOVERNANCE_DISCLOSURE", "label": "治理结构与近90天公告", "total": 8, "red_flag": 0, "warn": 0, "unknown": 0, "pass": 8},
        ],
        "rules": rules,
        "recent_disclosures": [
            {"title": "2026年第三季度报告（E2E脱敏示例）", "date": "2026-10-29", "url": ""},
        ],
        "pledge_ratio_pct": 0.42,
        "restricted_unlock_pct": 0.0,
        "data_sources": {"financial_indicator": "mock_e2e_sanitized", "cninfo_disclosure_90d": "mock_e2e_sanitized"},
        "notice": "脱敏 E2E 模拟排雷基线：30 条规则仅作只读研究展示，不构成下单依据。",
        "research_only": True,
        "execution_allowed": False,
    }


def _debate_payload(subject_id: str, asset_type_hint: str = "") -> dict[str, Any]:
    clean = subject_id.strip().upper() or "600900"
    return {
        "subject_id": clean,
        "subject_name": "示例电力" if "600900" in clean else f"示例标的 {clean}",
        "asset_type": asset_type_hint.strip().upper() or "STOCK",
        "as_of": "2026-11-18",
        "claim_ledger_status": "VERIFIED",
        "action_lock": "WAIT",
        "action_label_zh": "未准入 · 等待（模拟）",
        "research_action": "BUY",
        "admission_state": "NOT_ADMITTED",
        "account_snapshot_id": "DEMO-STOCK-SNAPSHOT",
        "composite_conviction_score": 71.0,
        "minesweeper_overall_status": "RED_FLAG",
        "minesweeper_red_flags": 1,
        "minesweeper_warn_count": 1,
        "minesweeper_unknown_count": 0,
        "perspectives": [
            {
                "perspective": "BULL_FUNDAMENTAL",
                "title_zh": "1. 多方基本面与赔率派",
                "role_summary": "围绕盈利现金流韧性、估值安全边际与 ValueInvest 评分拆解看多主线。",
                "supported_count": 2,
                "caution_or_unknown_count": 0,
                "arguments": [
                    {
                        "argument_id": "BULL-1",
                        "perspective": "BULL_FUNDAMENTAL",
                        "claim_id": f"CLM-{clean}-BULL-1",
                        "verification_status": "SUPPORTED",
                        "source_id": "valueinvest_pit",
                        "as_of": "2026-11-18",
                        "stance": "SUPPORT",
                        "headline": "现金流覆盖与长期安全边际具备支撑",
                        "detail": "F-Score 与经营现金流比维持稳健区间，赔率处于正期望范围。",
                    }
                ],
            },
            {
                "perspective": "TREND_FLOW_STRUCTURE",
                "title_zh": "2. 资金趋势与结构派",
                "role_summary": "评估波动收敛、回撤保护与微观结构顺逆风。",
                "supported_count": 1,
                "caution_or_unknown_count": 0,
                "arguments": [
                    {
                        "argument_id": "TREND-1",
                        "perspective": "TREND_FLOW_STRUCTURE",
                        "claim_id": f"CLM-{clean}-TREND-1",
                        "verification_status": "SUPPORTED",
                        "source_id": "daily_kline_structure",
                        "as_of": "2026-11-18",
                        "stance": "SUPPORT",
                        "headline": "中期均线结构维持中性偏多",
                        "detail": "T+1 摩擦回测未触发异常尾部回撤告警。",
                    }
                ],
            },
            {
                "perspective": "DEVILS_ADVOCATE",
                "title_zh": "3. 空方排雷派（Devil's Advocate）",
                "role_summary": "强制执行反证与排雷核查，聚焦 red_flag / warn 与证伪条件。",
                "supported_count": 0,
                "caution_or_unknown_count": 2,
                "arguments": [
                    {
                        "argument_id": "BEAR-1",
                        "perspective": "DEVILS_ADVOCATE",
                        "claim_id": f"CLM-{clean}-BEAR-FM05",
                        "verification_status": "CONFLICTED",
                        "source_id": "filing_minesweeper_30",
                        "as_of": "2026-11-18",
                        "stance": "OPPOSE",
                        "headline": "排雷引擎命中 FM-05 负债与流动性提示",
                        "detail": "需结合行业重资产属性复核债务久期，避免单维指标误判或盲目乐观。",
                    }
                ],
            },
            {
                "perspective": "OPPORTUNITY_COST",
                "title_zh": "4. 机会成本挑战派",
                "role_summary": "结合跨资产替代篮子与组合相关性校验增量夏普改善。",
                "supported_count": 0,
                "caution_or_unknown_count": 1,
                "arguments": [
                    {
                        "argument_id": "OPP-1",
                        "perspective": "OPPORTUNITY_COST",
                        "claim_id": f"CLM-{clean}-OPP-1",
                        "verification_status": "UNKNOWN",
                        "source_id": "opportunity_cost_matrix",
                        "as_of": "2026-11-18",
                        "stance": "CAUTION",
                        "headline": "需与备选指数/红利ETF比较税后风险收益比",
                        "detail": "当前组合相关性与替代候选尚需持续观察流动性窗口变化。",
                    }
                ],
            },
        ],
        "dominant_tension": "稳健现金流赔率 vs. 财报排雷红旗（FM-05）与替代机会成本权衡。",
        "change_triggers": ["下期季报自由现金流转负或质押率突破红线", "替代高分红资产赔率显著扩大"],
        "research_only": True,
        "execution_allowed": False,
    }


def _global_pulse_payload() -> dict[str, Any]:
    items = [
        {"code": "NDX", "name": "纳斯达克100", "short_name": "纳指100", "region": "US", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 25028.98, "prev_close": 26517.05, "change": -1488.07, "change_pct": -5.61, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 06:30:00", "meta": {}},
        {"code": "SPX", "name": "标普500", "short_name": "标普500", "region": "US", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 6602.99, "prev_close": 6812.00, "change": -209.01, "change_pct": -3.07, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 06:30:00", "meta": {}},
        {"code": "DJIA", "name": "道琼斯工业", "short_name": "道指", "region": "US", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 46245.41, "prev_close": 47080.00, "change": -834.59, "change_pct": -1.77, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 06:30:00", "meta": {}},
        {"code": "HSI", "name": "恒生指数", "short_name": "恒指", "region": "APAC", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 22410.80, "prev_close": 22841.62, "change": -430.82, "change_pct": -1.89, "session_state": "TRADING", "session_label": "盘中", "exchange_tz": "Asia/Hong_Kong", "source": "mock", "source_time": "2026-11-20 14:30:00", "meta": {}},
        {"code": "HSTECH", "name": "恒生科技", "short_name": "恒科", "region": "APAC", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 5112.40, "prev_close": 5210.00, "change": -97.60, "change_pct": -1.87, "session_state": "TRADING", "session_label": "盘中", "exchange_tz": "Asia/Hong_Kong", "source": "mock", "source_time": "2026-11-20 14:30:00", "meta": {}},
        {"code": "N225", "name": "日经225", "short_name": "日经225", "region": "APAC", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 56436.65, "prev_close": 59444.21, "change": -3007.56, "change_pct": -5.06, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Asia/Tokyo", "source": "mock", "source_time": "2026-11-20 14:30:01", "meta": {}},
        {"code": "KS11", "name": "韩国综合", "short_name": "韩国综合", "region": "APAC", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 5379.08, "prev_close": 5560.00, "change": -180.92, "change_pct": -3.25, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Asia/Seoul", "source": "mock", "source_time": "2026-11-20 14:30:00", "meta": {}},
        {"code": "TWII", "name": "台湾加权", "short_name": "台湾加权", "region": "APAC", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 36033.29, "prev_close": 38426.89, "change": -2393.60, "change_pct": -6.23, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Asia/Taipei", "source": "mock", "source_time": "2026-11-20 13:33:00", "meta": {}},
        {"code": "GDAXI", "name": "德国DAX", "short_name": "德国DAX", "region": "EU", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": True, "status": "OK", "price": 22891.50, "prev_close": 23100.00, "change": -208.50, "change_pct": -0.90, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Europe/Berlin", "source": "mock", "source_time": "2026-11-20 17:35:00", "meta": {}},
        {"code": "SX5E", "name": "欧洲斯托克50", "short_name": "斯托克50", "region": "EU", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 5466.03, "prev_close": 5510.00, "change": -43.97, "change_pct": -0.80, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Europe/Berlin", "source": "mock", "source_time": "2026-11-20 17:35:00", "meta": {}},
        {"code": "FTSE", "name": "英国富时100", "short_name": "富时100", "region": "EU", "kind": "INDEX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 9478.70, "prev_close": 9520.00, "change": -41.30, "change_pct": -0.43, "session_state": "CLOSED", "session_label": "昨收(已休市)", "exchange_tz": "Europe/London", "source": "mock", "source_time": "2026-11-20 16:35:00", "meta": {}},
        {"code": "USDCNH", "name": "离岸人民币", "short_name": "离岸人民币", "region": "MACRO", "kind": "FX", "unit": "CNH", "decimals": 4, "core8": True, "status": "OK", "price": 6.6737, "prev_close": 6.6934, "change": -0.0197, "change_pct": -0.29, "session_state": "24H", "session_label": "连续交易", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 05:59:59", "meta": {}},
        {"code": "UDI", "name": "美元指数", "short_name": "美元指数", "region": "MACRO", "kind": "FX", "unit": "pt", "decimals": 2, "core8": False, "status": "OK", "price": 103.84, "prev_close": 103.94, "change": -0.10, "change_pct": -0.10, "session_state": "24H", "session_label": "连续交易", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 05:59:00", "meta": {}},
        {"code": "GOLD", "name": "COMEX黄金", "short_name": "COMEX黄金", "region": "MACRO", "kind": "COMMODITY", "unit": "USD/oz", "decimals": 2, "core8": True, "status": "OK", "price": 3535.39, "prev_close": 3633.80, "change": -98.41, "change_pct": -2.71, "session_state": "24H", "session_label": "连续交易", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 05:59:57", "meta": {}},
        {"code": "WTI", "name": "WTI原油", "short_name": "WTI原油", "region": "MACRO", "kind": "COMMODITY", "unit": "USD/bbl", "decimals": 2, "core8": False, "status": "OK", "price": 69.25, "prev_close": 70.10, "change": -0.85, "change_pct": -1.21, "session_state": "24H", "session_label": "连续交易", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-21 05:59:50", "meta": {}},
        {"code": "US10Y", "name": "10年期美债", "short_name": "美债10Y", "region": "MACRO", "kind": "RATE", "unit": "%", "decimals": 3, "core8": False, "status": "OK", "price": 4.920, "prev_close": 5.040, "change": -0.120, "change_pct": -2.38, "session_state": "DAILY", "session_label": "日频最新", "exchange_tz": "America/New_York", "source": "mock", "source_time": "2026-11-20", "meta": {"cn10y_yield": 1.5803, "cn10y_change_bp": 0.48, "us10y_change_bp": -12.0, "spread_bps": -334.0, "rate_date": "2026-11-20"}},
    ]
    return {
        "scope": "GLOBAL_MACRO_CONTEXT_ONLY",
        "research_only": True,
        "execution_allowed": False,
        "as_of_bj": "2026-11-21 06:30:00",
        "stale": False,
        "throttled": False,
        "warnings": [],
        "items": items,
        "cross_border_anchors": {
            "ndx_pct": -5.61,
            "spx_pct": -3.07,
            "hsi_pct": -1.89,
            "hstech_pct": -1.87,
            "n225_pct": -5.06,
            "ks11_pct": -3.25,
            "usdcnh_price": 6.6737,
            "usdcnh_pct": -0.29,
            "gold_pct": -2.71,
            "wti_pct": -1.21,
            "us10y_yield": 4.920,
            "cn_us_spread_bps": -334.0,
        },
    }


_MOCK_GLOBAL_STOCKS: dict[str, list[dict[str, Any]]] = {
    "hk": [
        {"symbol": "hk00700", "raw_code": "700", "market": "hk", "name": "腾讯控股", "en_name": "Tencent Holdings", "exchange": "HKEX", "currency": "HKD", "currency_note": "", "price": 344.0, "change_pct": -1.26, "volume": 41094469, "market_cap": 3.10e12, "amount": 1.41e10, "pe_ttm": 11.82, "sector_key": "technology_services", "sector": "科技服务", "industry": "套装软件"},
        {"symbol": "hk09988", "raw_code": "9988", "market": "hk", "name": "阿里巴巴-W", "en_name": "Alibaba Group", "exchange": "HKEX", "currency": "HKD", "currency_note": "", "price": 88.5, "change_pct": 1.35, "volume": 28000000, "market_cap": 1.70e12, "amount": 2.48e9, "pe_ttm": 13.4, "sector_key": "retail_trade", "sector": "零售行业", "industry": "互联网零售"},
    ],
    "us": [
        {"symbol": "usNVDA", "raw_code": "NVDA", "market": "us", "name": "英伟达", "en_name": "NVIDIA Corp.", "exchange": "NASDAQ", "currency": "USD", "currency_note": "", "price": 125.53, "change_pct": -3.25, "volume": 92000000, "market_cap": 3.03e12, "amount": 1.15e10, "pe_ttm": 42.1, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "半导体"},
        {"symbol": "usAAPL", "raw_code": "AAPL", "market": "us", "name": "苹果", "en_name": "Apple Inc.", "exchange": "NASDAQ", "currency": "USD", "currency_note": "", "price": 342.56, "change_pct": -1.90, "volume": 80500000, "market_cap": 4.98e12, "amount": 2.76e10, "pe_ttm": 38.17, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "电信设备"},
    ],
    "jp": [
        {"symbol": "jp7203", "raw_code": "7203", "market": "jp", "name": "丰田汽车", "en_name": "Toyota Motor Corp.", "exchange": "TSE", "currency": "JPY", "currency_note": "", "price": 3312.0, "change_pct": -1.95, "volume": 26980700, "market_cap": 3.92e13, "amount": 8.93e10, "pe_ttm": 9.62, "sector_key": "consumer_durables", "sector": "耐用消费品", "industry": "机动车"},
        {"symbol": "jp8035", "raw_code": "8035", "market": "jp", "name": "东京电子", "en_name": "Tokyo Electron", "exchange": "TSE", "currency": "JPY", "currency_note": "", "price": 24500.0, "change_pct": 1.12, "volume": 4100000, "market_cap": 1.15e13, "amount": 1.00e11, "pe_ttm": 24.5, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "半导体"},
    ],
    "kr": [
        {"symbol": "kr005930", "raw_code": "005930", "market": "kr", "name": "三星电子", "en_name": "Samsung Electronics", "exchange": "KRX", "currency": "KRW", "currency_note": "", "price": 183100.0, "change_pct": -7.01, "volume": 17518562, "market_cap": 1.17e15, "amount": 3.21e12, "pe_ttm": 5.73, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "半导体"},
        {"symbol": "kr000660", "raw_code": "000660", "market": "kr", "name": "SK海力士", "en_name": "SK hynix Inc.", "exchange": "KRX", "currency": "KRW", "currency_note": "", "price": 1113000.0, "change_pct": -5.92, "volume": 3237873, "market_cap": 7.85e14, "amount": 3.60e12, "pe_ttm": 4.21, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "半导体"},
        {"symbol": "kq247540", "raw_code": "247540", "market": "kr", "name": "艾可普罗BM", "en_name": "Ecopro BM", "exchange": "KOSDAQ", "currency": "KRW", "currency_note": "", "price": 160000.0, "change_pct": 1.40, "volume": 1200000, "market_cap": 1.50e13, "amount": 1.92e11, "pe_ttm": 28.0, "sector_key": "process_industries", "sector": "加工工业", "industry": "化工"},
    ],
    "eu": [
        {"symbol": "euASML.AS", "raw_code": "ASML", "market": "eu", "name": "阿斯麦", "en_name": "ASML Holding NV", "exchange": "EURONEXT", "currency": "EUR", "currency_note": "", "price": 1168.0, "change_pct": -9.33, "volume": 1460181, "market_cap": 4.89e11, "amount": 1.87e9, "pe_ttm": 33.37, "sector_key": "electronic_technology", "sector": "电子科技", "industry": "半导体"},
        {"symbol": "euAZN.L", "raw_code": "AZN", "market": "eu", "name": "阿斯利康", "en_name": "AstraZeneca PLC", "exchange": "LSE", "currency": "GBX", "currency_note": "便士(GBX=0.01GBP)", "price": 13412.0, "change_pct": 0.81, "volume": 2100000, "market_cap": 2.10e11, "amount": 2.81e8, "pe_ttm": 21.2, "sector_key": "health_technology", "sector": "健康科技", "industry": "大型制药"},
    ],
}


def _global_market_overview_payload(market: str) -> dict[str, Any]:
    mk = market if market in _MOCK_GLOBAL_STOCKS else "hk"
    stocks = _MOCK_GLOBAL_STOCKS[mk]
    labels = {"hk": ("港股", "HKD"), "us": ("美股", "USD"), "jp": ("日股", "JPY"), "kr": ("韩股", "KRW"), "eu": ("欧股", "EUR")}
    label, cur = labels[mk]
    lead = stocks[0]
    sectors = [
        {
            "board_code": lead["sector_key"],
            "name": lead["sector"],
            "change_pct": lead["change_pct"],
            "change_method": "cap_weighted",
            "total_market_cap": sum(s["market_cap"] for s in stocks if s["sector_key"] == lead["sector_key"]),
            "total_amount": sum(s["amount"] for s in stocks if s["sector_key"] == lead["sector_key"]),
            "rise_count": sum(1 for s in stocks if s["change_pct"] > 0),
            "fall_count": sum(1 for s in stocks if s["change_pct"] < 0),
            "flat_count": 0,
            "constituent_count": len(stocks),
            "leading_stock_symbol": lead["symbol"],
            "leading_stock_name": lead["name"],
            "leading_stock_pct": lead["change_pct"],
        }
    ]
    return {
        "market": mk, "market_label": label, "currency": cur, "status": "OK", "as_of_bj": "2026-11-22 18:00:00",
        "session": {"state": "CLOSED", "label": "昨收(已休市)", "exchange_tz": "UTC"},
        "summary": {
            "total_count": len(stocks),
            "rise_count": sum(1 for s in stocks if s["change_pct"] > 0),
            "fall_count": sum(1 for s in stocks if s["change_pct"] < 0),
            "flat_count": 0,
            "total_amount": sum(s["amount"] for s in stocks),
            "total_market_cap": sum(s["market_cap"] for s in stocks),
            "index_anchors": _global_pulse_payload()["items"][:2],
        },
        "sectors": sectors, "sub_industries": sectors, "stocks": stocks, "stale": False, "warnings": [],
        "research_only": True, "execution_allowed": False,
    }


def _global_chart_payload(symbol: str, period: str) -> dict[str, Any]:
    all_rows = [r for rows in _MOCK_GLOBAL_STOCKS.values() for r in rows]
    hit = next((r for r in all_rows if r["symbol"].lower() == symbol.lower()), all_rows[0])
    base = float(hit["price"])
    if period == "timeline":
        pts = [
            {"time": f"09:{30 + i * 5:02d}", "price": round(base * (0.99 + i * 0.002), 2), "avgPrice": round(base * 0.996, 2), "volume": 10000 + i * 500}
            for i in range(6)
        ]
        return {
            "symbol": hit["symbol"], "market": hit["market"], "currency": hit["currency"], "exchange_tz": "Asia/Seoul",
            "date": "2026-11-20", "prevClose": round(base * 1.02, 2), "data": pts, "source": "mock",
            "stale": False, "warnings": [], "research_only": True, "execution_allowed": False,
        }
    bars = [
        {
            "date": f"2026-11-{i + 1:02d}", "time": f"2026-11-{i + 1:02d}",
            "open": round(base * (0.95 + i * 0.002), 2), "close": round(base * (0.955 + i * 0.002), 2),
            "high": round(base * (0.96 + i * 0.002), 2), "low": round(base * (0.945 + i * 0.002), 2),
            "volume": 100000 + i * 1000,
            "ma": {"ma5": round(base * 0.96, 2), "ma10": round(base * 0.95, 2), "ma20": round(base * 0.94, 2)},
        }
        for i in range(25)
    ]
    return {
        "symbol": hit["symbol"], "market": hit["market"], "currency": hit["currency"], "period": period,
        "bars": bars, "source": "mock", "stale": False, "warnings": [], "research_only": True, "execution_allowed": False,
    }


def _market_payload(path: str) -> dict[str, Any]:
    demo_boards = [
        {
            "rank": 1,
            "name": "电力行业",
            "code": "BK0428",
            "price": 1820.5,
            "change": 18.4,
            "changePercent": 1.02,
            "totalMarketCap": 3500.0,
            "turnoverRate": 1.15,
            "riseCount": 36,
            "fallCount": 14,
            "leadingStock": "长江电力",
            "leadingStockCode": "600900",
            "leadingStockChangePercent": 1.06,
        },
        {
            "rank": 2,
            "name": "电子元件",
            "code": "BK0459",
            "price": 2410.8,
            "change": 42.1,
            "changePercent": 1.78,
            "totalMarketCap": 4200.0,
            "turnoverRate": 2.34,
            "riseCount": 58,
            "fallCount": 22,
            "leadingStock": "胜宏科技",
            "leadingStockCode": "300476",
            "leadingStockChangePercent": 2.45,
        },
    ]
    if path.endswith("/constituents"):
        return {
            "items": [
                {
                    "code": "600900",
                    "name": "长江电力",
                    "price": 28.5,
                    "changePercent": 1.06,
                    "change": 0.3,
                    "volume": 120000,
                    "amount": 34000,
                    "amplitude": 1.4,
                    "high": 28.6,
                    "low": 28.1,
                    "open": 28.2,
                    "prevClose": 28.2,
                    "turnoverRate": 0.5,
                    "pe": 18.5,
                    "pb": 2.8,
                }
            ]
        }
    if path.endswith("/kline"):
        return {
            "items": [
                {
                    "date": f"2026-11-{10 + i:02d}",
                    "open": 1800.0 + i * 5,
                    "close": 1805.0 + i * 5,
                    "high": 1812.0 + i * 5,
                    "low": 1796.0 + i * 5,
                    "volume": 1000000,
                    "amount": 500000000,
                    "changePercent": 0.65,
                }
                for i in range(5)
            ],
            "klineSource": "demo",
            "klineSourceLabel": "E2E 演示K线",
            "sampledConstituents": 10,
        }
    if path.endswith("/summary"):
        return {"meta": demo_boards[0], "spot": []}
    if path.endswith("/spot"):
        return {"items": [{"item": "最新价", "value": 1820.5}, {"item": "涨跌幅", "value": 1.02}]}
    if path.endswith("/boards/industry") or path.endswith("/boards/concept"):
        return {"items": demo_boards}
    if path.endswith("/fund-flow") or "/fund-flow/" in path:
        return {
            "items": [
                {
                    "date": "2026-11-13",
                    "code": "600900",
                    "name": "长江电力",
                    "mainNetInflow": 12000000.0,
                    "mainNetInflowPercent": 1.85,
                    "superLargeNetInflow": 8000000.0,
                    "largeNetInflow": 4000000.0,
                    "mediumNetInflow": -5000000.0,
                    "smallNetInflow": -7000000.0,
                }
            ],
            "periods": [],
            "dailyHistory": [],
            "flowSource": "demo",
            "flowSourceLabel": "E2E 演示资金流",
            "sampledConstituents": 10,
        }
    return {"items": []}


def create_server(args: argparse.Namespace) -> ThreadingHTTPServer:
    dist_dir = Path(args.dist_dir).resolve()
    bundle_state = build_bundle_zip(dist_dir)

    apk_path = Path(args.apk_path).resolve() if args.apk_path else None
    apk_bytes = apk_path.read_bytes() if apk_path and apk_path.is_file() else b""
    apk_sha256 = hashlib.sha256(apk_bytes).hexdigest() if apk_bytes else ""

    meta: dict[str, Any] = {}
    if args.apk_meta_json and Path(args.apk_meta_json).is_file():
        meta = json.loads(Path(args.apk_meta_json).read_text(encoding="utf-8"))

    scheduler_state: dict[str, Any] = {
        "enabled": False,
        "daemon_running": False,
        "is_readonly_view": bool(args.require_auth),
        "config_path": "" if args.require_auth else "C:/Users/Demo/AppData/Local/Touzizhuanjia/scheduler_config.json",
        "eod_scan_time": "14:45",
        "post_close_time": "15:35",
        "auto_record_journal": False,
        "auto_settle_journal": True,
        "windows_notify_enabled": True,
        "webhook_type": "none",
        "webhook_configured": False,
        "webhook_url_masked": "",
        "webhook_verified": False,
        "eod_scheme": {
            "scheme_name": "默认尾盘强趋势",
            "market_cap_min": 50.0,
            "market_cap_max": 200.0,
            "volume_ratio_min": 1.2,
            "change_percent_min": 3.0,
            "change_percent_max": 5.0,
            "turnover_rate_min": 5.0,
            "turnover_rate_max": 10.0,
            "exclude_st": True,
            "max_candidates": 5,
        },
        "watchlist_codes": ["600900", "300476"],
        "poll_interval_seconds": 20,
        "last_eod_scan_date": "2026-11-18",
        "last_post_close_date": "2026-11-18",
        "tray_badge": {"level": "ok", "text": "14:45 扫池 2 只 · GREEN"},
        "latest_briefing": {
            "run_id": "eod-demo-01",
            "task_type": "EOD_SCAN_1445",
            "triggered_at": "2026-11-18T14:45:03+08:00",
            "trade_date": "2026-11-18",
            "status": "OK",
            "summary_title": "[14:45 尾盘观察简报] 2026-11-18 · 情绪灯=GREEN",
            "summary_text": "情绪灯=GREEN | 仅限观察与研究核验（严禁自动下单/非买入指令）:\n1. 示例电力(600900) 现价 28.5 (+3.64%) | 安检=CLEAN / 30条排雷=CLEAN",
            "regime": "GREEN",
            "candidate_count": 1,
            "candidates": [],
            "red_flag_alerts": [],
            "notification_dispatched": True,
            "webhook_dispatched": False,
            "error": None,
        },
        "recent_runs": [
            {
                "run_id": "post-demo-01",
                "task_type": "POST_CLOSE_1535",
                "triggered_at": "2026-11-18T15:35:02+08:00",
                "trade_date": "2026-11-18",
                "status": "OK",
                "summary_title": "[15:35 盘后复盘简报] 2026-11-18 · 红旗 0 / 异动 1",
                "summary_text": "历史尾盘样本 T+1/T+3 结算更新: 1 项；持仓与自选股未新增 M4a 公告红旗。",
                "regime": None,
                "candidate_count": 0,
                "candidates": [],
                "red_flag_alerts": [],
                "notification_dispatched": True,
                "webhook_dispatched": False,
                "error": None,
            }
        ],
        "research_only": True,
        "execution_allowed": False,
    }

    installed_vc = int(meta.get("version_code") or 1004)
    advertised_vc = int(args.apk_version_code) if args.apk_version_code > 0 else installed_vc + 1
    advertised_vn = args.apk_version_name or f"5.0.{advertised_vc}"
    signing_sha256 = args.signing_sha256 or str(meta.get("signing_sha256") or "")

    class MockHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *msg_args: Any) -> None:
            return

        def _base_url(self) -> str:
            if args.public_base_url:
                return args.public_base_url.rstrip("/")
            host_hdr = self.headers.get("Host") or f"{args.host}:{args.port}"
            return f"http://{host_hdr}"

        def _send_bytes(
            self,
            status: int,
            body: bytes,
            content_type: str,
            extra_headers: dict[str, str] | None = None,
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header(
                "Access-Control-Expose-Headers",
                "X-Bundle-Sha256, X-Apk-Sha256, X-Apk-Version-Code",
            )
            for k, v in (extra_headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, status: int, payload: Any) -> None:
            self._send_bytes(
                status,
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def _is_bearer_valid(self) -> bool:
            if not args.require_auth:
                return True
            auth = (self.headers.get("Authorization") or "").strip()
            return auth == f"Bearer {args.token}"

        def do_OPTIONS(self) -> None:
            self._send_bytes(204, b"", "text/plain")

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/eod/"):
                if not self._is_bearer_valid():
                    self._send_json(401, {"detail": "Unauthorized"})
                    return
                if parsed.path == "/api/eod/analyze-vetting":
                    try:
                        length = int(self.headers.get("Content-Length") or 0)
                        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                    except Exception:
                        body = {}
                    candidates = body.get("candidates") or []
                    if len(candidates) > 30:
                        self._send_json(400, {"detail": "candidate limit exceeded"})
                        return
                    self._send_json(200, _eod_analyze_payload())
                    return
                if parsed.path in {"/api/eod/journal/record", "/api/eod/journal/settle"}:
                    self._send_json(
                        200,
                        {
                            "written": True,
                            "changed": 1,
                            "snapshot_id": "2026-11-13_default",
                            "stats": _eod_journal_payload()["stats"],
                            "research_only": True,
                            "execution_allowed": False,
                        },
                    )
                    return
                self._send_json(404, {"detail": f"Unknown mock API route: {parsed.path}"})
                return
            if parsed.path.startswith("/api/scheduler/"):
                if not self._is_bearer_valid():
                    self._send_json(401, {"detail": "Unauthorized"})
                    return
                if args.require_auth:
                    self._send_json(403, {"detail": "Desktop-only scheduler mutation forbidden on mobile_remote"})
                    return
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                except Exception:
                    body = {}
                if parsed.path == "/api/scheduler/config":
                    for k in ("enabled", "eod_scan_time", "post_close_time", "auto_record_journal", "auto_settle_journal", "windows_notify_enabled", "webhook_type", "eod_scheme", "watchlist_codes"):
                        if k in body and body[k] is not None:
                            scheduler_state[k] = body[k]
                    scheduler_state["daemon_running"] = bool(scheduler_state["enabled"])
                    if body.get("webhook_url"):
                        raw_u = str(body["webhook_url"])
                        scheduler_state["webhook_configured"] = True
                        scheduler_state["webhook_url_masked"] = f"https://hook/••••{raw_u[-4:]}"
                        scheduler_state["webhook_verified"] = False
                    self._send_json(200, scheduler_state)
                    return
                if parsed.path == "/api/scheduler/test-webhook":
                    scheduler_state["webhook_verified"] = True
                    rec = {
                        "run_id": "wh-demo-1",
                        "task_type": "TEST_WEBHOOK",
                        "triggered_at": "2026-11-18T15:00:00+08:00",
                        "trade_date": "2026-11-18",
                        "status": "OK",
                        "summary_title": "Webhook 测试成功",
                        "summary_text": "测试结果: HTTP 200 (Mock E2E)",
                        "regime": None,
                        "candidate_count": 0,
                        "candidates": [],
                        "red_flag_alerts": [],
                        "notification_dispatched": False,
                        "webhook_dispatched": True,
                        "error": None,
                    }
                    self._send_json(200, {"record": rec, "status": scheduler_state})
                    return
                if parsed.path == "/api/scheduler/run-now":
                    task = body.get("task", "eod")
                    is_eod = task == "eod"
                    rec = {
                        "run_id": f"manual-{task}-1",
                        "task_type": "EOD_SCAN_1445" if is_eod else "POST_CLOSE_1535",
                        "triggered_at": "2026-11-18T14:46:00+08:00" if is_eod else "2026-11-18T15:36:00+08:00",
                        "trade_date": "2026-11-18",
                        "status": "OK",
                        "summary_title": "[14:45 尾盘观察简报] 2026-11-18 · 情绪灯=GREEN" if is_eod else "[15:35 盘后复盘简报] 2026-11-18 · 红旗 0 / 异动 1",
                        "summary_text": "脱敏 E2E 试跑成功（只研不下单，非买入指令）。",
                        "regime": "GREEN" if is_eod else None,
                        "candidate_count": 2 if is_eod else 0,
                        "candidates": [],
                        "red_flag_alerts": [],
                        "notification_dispatched": True,
                        "webhook_dispatched": False,
                        "error": None,
                    }
                    scheduler_state["latest_briefing"] = rec
                    scheduler_state["recent_runs"] = [rec, *scheduler_state["recent_runs"][:4]]
                    self._send_json(200, {"record": rec, "status": scheduler_state})
                    return
            if parsed.path.startswith("/api/lwc/native-window/"):
                if not self._is_bearer_valid():
                    self._send_json(401, {"detail": "Unauthorized"})
                    return
                sym = parsed.path.rsplit("/", 1)[-1] or "600900"
                self._send_json(
                    200,
                    {
                        "status": "DEMO_OK",
                        "engine": "mock_lwc",
                        "payload_summary": {
                            "symbol": sym,
                            "bars_count": 15,
                            "research_only": True,
                            "execution_allowed": False,
                        },
                    },
                )
                return
            self._send_json(404, {"detail": "Not Found"})

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            ticket = (query.get("ticket") or [""])[0]

            if path == "/api/health":
                self._send_json(
                    200,
                    {
                        "status": "ok",
                        "version": "5.0-e2e",
                        "server_profile": "mobile",
                        "api_contract_version": 2,
                        "frontend_bundle_sha256": bundle_state["bundle_sha256"],
                        "lan_ips": ["10.0.2.2"],
                        "frontend_mode": "dist",
                        "dist_assets_count": bundle_state["file_count"],
                        "execution_lock_label": "只读研究模式",
                        "research_only": True,
                        "execution_allowed": False,
                    },
                )
                return

            if path == "/api/mobile/pairing":
                base = self._base_url()
                code_json = json.dumps(
                    {"lan_url": base, "remote_url": "", "device_token": args.token},
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send_json(
                    200,
                    {
                        "api_contract_version": 2,
                        "mobile_port": args.port,
                        "lan_ips": ["10.0.2.2"],
                        "primary_lan_ip": "10.0.2.2",
                        "tailscale_ip": None,
                        "tailscale_dns": None,
                        "lan_url": base,
                        "remote_url": "",
                        "device_token": args.token,
                        "pairing_code": base64.b64encode(code_json).decode("ascii"),
                    },
                )
                return

            if path == "/api/mobile/web-bundle/download":
                if not (_verify_ticket("bundle", ticket, args.token) or self._is_bearer_valid()):
                    self._send_json(401, {"detail": "Invalid bundle download ticket"})
                    return
                self._send_bytes(
                    200,
                    bundle_state["zip_data"],
                    "application/zip",
                    {"X-Bundle-Sha256": bundle_state["bundle_sha256"]},
                )
                return

            if path == "/api/mobile/app-release/download":
                if not apk_bytes:
                    self._send_json(404, {"detail": "No APK configured"})
                    return
                if not (_verify_ticket("apk", ticket, args.token) or self._is_bearer_valid()):
                    self._send_json(401, {"detail": "Invalid APK download ticket"})
                    return
                self._send_bytes(
                    200,
                    apk_bytes,
                    "application/vnd.android.package-archive",
                    {
                        "X-Apk-Sha256": apk_sha256,
                        "X-Apk-Version-Code": str(advertised_vc),
                    },
                )
                return

            if path.startswith("/api/"):
                if not self._is_bearer_valid():
                    self._send_json(401, {"detail": "Unauthorized"})
                    return

                if path == "/api/mobile/web-bundle/manifest":
                    dl_ticket = _sign_ticket("bundle", args.token)
                    self._send_json(
                        200,
                        {
                            "bundle_version": bundle_state["bundle_version"],
                            "bundle_sha256": bundle_state["bundle_sha256"],
                            "zip_sha256": bundle_state["zip_sha256"],
                            "zip_bytes": bundle_state["zip_bytes"],
                            "file_count": bundle_state["file_count"],
                            "total_bytes": bundle_state["total_bytes"],
                            "generated_at": bundle_state["generated_at"],
                            "download_url": f"/api/mobile/web-bundle/download?ticket={dl_ticket}",
                        },
                    )
                    return

                if path == "/api/mobile/app-release/latest":
                    if not apk_bytes:
                        self._send_json(200, {"available": False, "reason": "no_apk_configured"})
                        return
                    dl_ticket = _sign_ticket("apk", args.token)
                    self._send_json(
                        200,
                        {
                            "available": True,
                            "version_code": advertised_vc,
                            "version_name": advertised_vn,
                            "private_head_sha": "e2edemo0",
                            "signing_sha256": signing_sha256,
                            "apk_filename": apk_path.name if apk_path else "app-debug.apk",
                            "apk_bytes": len(apk_bytes),
                            "apk_sha256": apk_sha256,
                            "built_at": "2026-11-15T12:00:00Z",
                            "download_url": f"/api/mobile/app-release/download?ticket={dl_ticket}",
                        },
                    )
                    return

                if path == "/api/workbench":
                    self._send_json(200, _workbench_payload())
                    return
                if path == "/api/radar":
                    self._send_json(200, _radar_payload())
                    return
                if path == "/api/audit":
                    self._send_json(200, _audit_payload())
                    return
                if path == "/api/quantstats/tearsheet":
                    if (query.get("account_id") or ["STK-ALIPAY-001"])[0] == "FND-TIANTIAN-002":
                        self._send_json(422, {"detail": "DEMO: 历史数据不足", "source_status": "INSUFFICIENT_REAL_HISTORY"})
                    elif (query.get("format") or ["json"])[0] == "html":
                        self._send_bytes(200, b"<html><body><h3>QuantStats Synthetic Demo Tearsheet</h3></body></html>", "text/html; charset=utf-8")
                    else:
                        self._send_json(200, _quantstats_payload())
                    return
                if path == "/api/quantstats/html":
                    self._send_bytes(
                        200,
                        b"<html><body><h3>QuantStats Synthetic Demo Tearsheet</h3></body></html>",
                        "text/html; charset=utf-8",
                    )
                    return
                if path == "/api/eod/regime":
                    self._send_json(200, _eod_regime_payload())
                    return
                if path == "/api/eod/journal":
                    self._send_json(200, _eod_journal_payload())
                    return
                if path == "/api/portfolio/xray":
                    account_id = (query.get("account_id") or ["ALL"])[0]
                    payload = _portfolio_xray_payload(account_id)
                    if payload is None:
                        self._send_json(400, {"detail": f"Unsupported account_id={account_id!r}"})
                    else:
                        payload["account_snapshots"] = {
                            "STK-ALIPAY-001": {"snapshot_id": "DEMO-STOCK-SNAPSHOT", "as_of": "2026-11-13", "status": "SEEDED_DEFAULT"},
                            "FND-TIANTIAN-002": {"snapshot_id": "DEMO-FUND-SNAPSHOT", "as_of": "2026-11-13", "status": "FROZEN_HISTORICAL"},
                        }
                        self._send_json(200, payload)
                    return
                if path == "/api/scheduler/status":
                    self._send_json(200, scheduler_state)
                    return
                if path.startswith("/api/research/") and path.endswith("/minesweeper"):
                    sid = path.removeprefix("/api/research/").removesuffix("/minesweeper") or "600900"
                    hint = (query.get("asset_type") or [""])[0]
                    self._send_json(200, _minesweeper_payload(sid, hint))
                    return
                if path.startswith("/api/research/") and path.endswith("/debate"):
                    sid = path.removeprefix("/api/research/").removesuffix("/debate") or "600900"
                    hint = (query.get("asset_type") or [""])[0]
                    self._send_json(200, _debate_payload(sid, hint))
                    return
                if path.startswith("/api/research/"):
                    sid = path.removeprefix("/api/research/") or "600900"
                    self._send_json(200, _research_payload(sid))
                    return
                if path == "/api/market/global-pulse":
                    self._send_json(200, _global_pulse_payload())
                    return
                if path == "/api/market/global/overview":
                    mk = (query.get("market") or ["hk"])[0]
                    self._send_json(200, _global_market_overview_payload(mk))
                    return
                if path.startswith("/api/market/global/boards/") and path.endswith("/constituents"):
                    parts = path.strip("/").split("/")
                    mk = parts[4] if len(parts) >= 6 else "kr"
                    sec_key = parts[5] if len(parts) >= 6 else "electronic_technology"
                    ov = _global_market_overview_payload(mk)
                    items = [s for s in ov["stocks"] if s["sector_key"] == sec_key] or ov["stocks"]
                    self._send_json(200, {"market": mk, "sector_key": sec_key, "sector_name": items[0]["sector"], "as_of_bj": ov["as_of_bj"], "session": ov["session"], "items": items, "total_count": len(items), "stale": False, "warnings": [], "research_only": True, "execution_allowed": False})
                    return
                if path == "/api/market/global/quotes":
                    syms = [s.strip().lower() for s in ((query.get("symbols") or [""])[0]).split(",") if s.strip()]
                    all_rows = [r for rows in _MOCK_GLOBAL_STOCKS.values() for r in rows]
                    items = [r for r in all_rows if r["symbol"].lower() in syms]
                    self._send_json(200, {"items": items, "count": len(items), "warnings": [], "research_only": True, "execution_allowed": False})
                    return
                if path == "/api/market/global/chart":
                    sym = (query.get("symbol") or ["kr005930"])[0]
                    per = (query.get("period") or ["timeline"])[0]
                    self._send_json(200, _global_chart_payload(sym, per))
                    return
                if path == "/api/market/global/search":
                    kw = ((query.get("q") or [""])[0]).strip().lower()
                    all_rows = [r for rows in _MOCK_GLOBAL_STOCKS.values() for r in rows]
                    items = [r for r in all_rows if not kw or kw in r["symbol"].lower() or kw in r["name"].lower() or kw in r["en_name"].lower()]
                    self._send_json(200, {"items": items[:12], "count": len(items[:12]), "research_only": True, "execution_allowed": False})
                    return
                if path.startswith("/api/market/"):
                    self._send_json(200, _market_payload(path))
                    return
                self._send_json(404, {"detail": f"Unknown mock API route: {path}"})
                return

            rel = path.lstrip("/") or "index.html"
            candidate = (dist_dir / rel).resolve()
            if not str(candidate).startswith(str(dist_dir)) or not candidate.is_file():
                candidate = dist_dir / "index.html"
            ctype, _ = mimetypes.guess_type(str(candidate))
            self._send_bytes(200, candidate.read_bytes(), ctype or "application/octet-stream")

    return ThreadingHTTPServer((args.host, args.port), MockHandler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sanitized E2E mock gateway for UI & APK verification")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8502)
    parser.add_argument("--dist-dir", default=str(Path(__file__).resolve().parents[1] / "dist"))
    parser.add_argument("--public-base-url", default="")
    parser.add_argument("--apk-path", default="")
    parser.add_argument("--apk-meta-json", default="")
    parser.add_argument("--apk-version-code", type=int, default=0)
    parser.add_argument("--apk-version-name", default="")
    parser.add_argument("--signing-sha256", default="")
    parser.add_argument("--token", default=DEFAULT_TOKEN)
    parser.add_argument("--require-auth", action="store_true")
    args = parser.parse_args()

    server = create_server(args)
    print(f"mock_server listening on http://{args.host}:{args.port} (auth={args.require_auth})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
