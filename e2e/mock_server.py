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
        "decision_packet": {
            "subject_id": subject_id,
            "subject_name": name,
            "asset_type": asset_type,
            "as_of": "2026-11-13",
            "currently_held": clean in {"600900", "300476", "018956"},
            "action": action,
            "action_label_zh": label,
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
        "backtest_summary": {
            "strategy_name": "A股 T+1 次日开盘示范策略",
            "total_return_1x_pct": 14.8,
            "total_return_2x_pct": 11.6,
            "max_drawdown_1x_pct": -6.4,
            "sharpe_1x": 1.35,
            "win_rate_pct": 58.3,
            "trade_count": 12,
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
                    self._send_json(200, _quantstats_payload())
                    return
                if path == "/api/quantstats/html":
                    self._send_bytes(
                        200,
                        b"<html><body><h3>QuantStats Synthetic Demo Tearsheet</h3></body></html>",
                        "text/html; charset=utf-8",
                    )
                    return
                if path.startswith("/api/research/"):
                    sid = path.removeprefix("/api/research/") or "600900"
                    self._send_json(200, _research_payload(sid))
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
