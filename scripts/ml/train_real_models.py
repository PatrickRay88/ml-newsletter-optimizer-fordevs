#!/usr/bin/env python3
# pyright: reportMissingImports=false
import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    import joblib
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier  # pyright: ignore[reportMissingImports]
    from sklearn.feature_extraction import DictVectorizer  # pyright: ignore[reportMissingImports]
    from sklearn.isotonic import IsotonicRegression  # pyright: ignore[reportMissingImports]
    from sklearn.linear_model import LogisticRegression  # pyright: ignore[reportMissingImports]
    from sklearn.metrics import (  # pyright: ignore[reportMissingImports]
        accuracy_score,
        average_precision_score,
        brier_score_loss,
        log_loss,
        roc_auc_score,
    )
except ImportError as exc:
    print(
        "Missing Python ML dependencies. Install with `pip install -r scripts/ml/requirements.txt`.",
        file=sys.stderr,
    )
    print(str(exc), file=sys.stderr)
    raise SystemExit(2)

HOURS_PER_WEEK = 7 * 24


def _safe_probability_metrics(
    y_true: np.ndarray, y_prob: np.ndarray, threshold: float = 0.5
) -> Dict[str, Any]:
    metrics: Dict[str, Any] = {}
    y_pred = (y_prob >= threshold).astype(int)

    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))

    precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    accuracy = float(accuracy_score(y_true, y_pred))
    metrics["accuracy"] = accuracy if math.isfinite(accuracy) else None
    try:
        auc = float(roc_auc_score(y_true, y_prob))
        metrics["auc"] = auc if math.isfinite(auc) else None
    except ValueError:
        metrics["auc"] = None

    try:
        pr_auc = float(average_precision_score(y_true, y_prob))
        metrics["pr_auc"] = pr_auc if math.isfinite(pr_auc) else None
    except ValueError:
        metrics["pr_auc"] = None

    try:
        ll = float(log_loss(y_true, y_prob, labels=[0, 1]))
        metrics["log_loss"] = ll if math.isfinite(ll) else None
    except ValueError:
        metrics["log_loss"] = None

    try:
        brier = float(brier_score_loss(y_true, y_prob))
        metrics["brier_score"] = brier if math.isfinite(brier) else None
    except ValueError:
        metrics["brier_score"] = None

    metrics["precision"] = float(precision)
    metrics["recall"] = float(recall)
    metrics["f1"] = float(f1)
    metrics["threshold"] = float(threshold)

    return metrics


def _split_points(count: int, train_ratio: float = 0.7, cal_ratio: float = 0.15) -> Tuple[int, int]:
    if count < 6:
        train_end = max(1, count - 2)
        cal_end = max(train_end + 1, count - 1)
        return train_end, cal_end

    train_end = int(count * train_ratio)
    cal_end = int(count * (train_ratio + cal_ratio))

    train_end = max(1, min(count - 2, train_end))
    cal_end = max(train_end + 1, min(count - 1, cal_end))
    return train_end, cal_end


def _fit_calibrator(y_true: np.ndarray, y_prob: np.ndarray) -> Tuple[Any, str]:
    if y_true.size < 20 or np.unique(y_true).size < 2:
        return None, "none"

    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(y_prob, y_true)
    return calibrator, "isotonic"


def _apply_calibrator(calibrator: Any, y_prob: np.ndarray) -> np.ndarray:
    if calibrator is None:
        return y_prob

    transformed = calibrator.transform(y_prob)
    return np.asarray(np.clip(transformed, 0.0, 1.0), dtype=np.float64)


def _tune_threshold(y_true: np.ndarray, y_prob: np.ndarray) -> Dict[str, float]:
    if y_true.size == 0:
        return {"threshold": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0}

    candidate_thresholds = np.linspace(0.05, 0.95, 19)
    best = {"threshold": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0}

    for threshold in candidate_thresholds:
        y_pred = (y_prob >= threshold).astype(int)
        tp = int(np.sum((y_true == 1) & (y_pred == 1)))
        fp = int(np.sum((y_true == 0) & (y_pred == 1)))
        fn = int(np.sum((y_true == 1) & (y_pred == 0)))

        precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

        if f1 > best["f1"] or (f1 == best["f1"] and precision > best["precision"]):
            best = {
                "threshold": float(threshold),
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
            }

    return best


def _extract_send_time_features(sample: Dict[str, Any]) -> Dict[str, Any]:
    ignore = {"clicked", "sent_at", "message_id"}
    return {key: value for key, value in sample.items() if key not in ignore}


def _build_recommendations(
    model: Any,
    vectorizer: DictVectorizer,
    calibrator: Any,
    contact_samples: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []

    for contact in contact_samples:
        contact_id = str(contact.get("contact_id", "")).strip()
        if not contact_id:
            continue

        propensity = float(contact.get("propensity", 0.0))
        lifecycle_stage = str(contact.get("lifecycle_stage", "unknown"))
        tag_count = int(contact.get("tag_count", 0))

        candidate_rows: List[Dict[str, Any]] = []
        for hour in range(HOURS_PER_WEEK):
            candidate_rows.append(
                {
                    "hour_of_week": hour,
                    "day_of_week": hour // 24,
                    "hour_of_day": hour % 24,
                    "is_weekend": 1 if (hour // 24) in (0, 6) else 0,
                    "propensity": propensity,
                    "lifecycle_stage": lifecycle_stage,
                    "tag_count": tag_count,
                }
            )

        x = vectorizer.transform(candidate_rows)
        raw_prob = model.predict_proba(x)[:, 1]
        calibrated_prob = _apply_calibrator(calibrator, raw_prob)

        best_index = int(np.argmax(calibrated_prob))
        best_score = float(calibrated_prob[best_index])
        baseline_score = float(np.mean(calibrated_prob))

        recommendations.append(
            {
                "contact_id": contact_id,
                "recommended_hour": best_index,
                "score": best_score,
                "baseline_score": baseline_score,
            }
        )

    return recommendations


def train_send_time(
    samples: List[Dict[str, Any]],
    contact_samples: List[Dict[str, Any]],
    artifacts_root: Path,
    trained_at: str,
) -> Dict[str, Any]:
    if not samples:
        return {
            "status": "no_data",
            "algorithm": "random_forest",
            "sample_count": 0,
            "positive_rate": 0.0,
            "metrics": {},
            "artifact_relative_path": None,
            "feature_names": [],
            "calibration": {"method": "none"},
            "threshold": {"classification": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0},
            "contact_recommendations": [],
            "warning": "No send-time samples were provided",
        }

    ordered = sorted(samples, key=lambda row: str(row.get("sent_at", "")))
    labels = np.array([int(row.get("clicked", 0)) for row in ordered], dtype=np.int32)
    positives = int(np.sum(labels))
    positive_rate = float(np.mean(labels)) if labels.size else 0.0

    if positives == 0 or positives == len(ordered):
        return {
            "status": "single_class",
            "algorithm": "random_forest",
            "sample_count": len(ordered),
            "positive_rate": positive_rate,
            "metrics": {},
            "artifact_relative_path": None,
            "feature_names": [],
            "calibration": {"method": "none"},
            "threshold": {"classification": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0},
            "contact_recommendations": [],
            "warning": "Send-time dataset has only one target class",
        }

    train_end, cal_end = _split_points(len(ordered))
    train_rows = ordered[:train_end]
    cal_rows = ordered[train_end:cal_end]
    test_rows = ordered[cal_end:]

    if len(cal_rows) == 0:
        cal_rows = train_rows[-1:]
    if len(test_rows) == 0:
        test_rows = cal_rows

    vectorizer = DictVectorizer(sparse=False)
    x_train = vectorizer.fit_transform([_extract_send_time_features(row) for row in train_rows])
    y_train = np.array([int(row.get("clicked", 0)) for row in train_rows], dtype=np.int32)

    x_cal = vectorizer.transform([_extract_send_time_features(row) for row in cal_rows])
    y_cal = np.array([int(row.get("clicked", 0)) for row in cal_rows], dtype=np.int32)

    x_test = vectorizer.transform([_extract_send_time_features(row) for row in test_rows])
    y_test = np.array([int(row.get("clicked", 0)) for row in test_rows], dtype=np.int32)

    model = RandomForestClassifier(
        n_estimators=240,
        max_depth=10,
        min_samples_leaf=6,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(x_train, y_train)

    y_prob_cal_raw = model.predict_proba(x_cal)[:, 1]
    calibrator, calibration_method = _fit_calibrator(y_cal, y_prob_cal_raw)
    y_prob_calibrated = _apply_calibrator(calibrator, y_prob_cal_raw)
    tuned_threshold = _tune_threshold(y_cal, y_prob_calibrated)

    y_prob_test_raw = model.predict_proba(x_test)[:, 1]
    y_prob_test_calibrated = _apply_calibrator(calibrator, y_prob_test_raw)

    metrics = _safe_probability_metrics(
        y_test, y_prob_test_calibrated, threshold=tuned_threshold["threshold"]
    )
    raw_metrics = _safe_probability_metrics(y_test, y_prob_test_raw, threshold=0.5)

    recommendations = _build_recommendations(model, vectorizer, calibrator, contact_samples)

    artifact_dir = artifacts_root / "send_time_real_v1" / trained_at.replace(":", "-")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / "model.joblib"

    joblib.dump(
        {
            "vectorizer": vectorizer,
            "model": model,
            "calibrator": calibrator,
            "calibration_method": calibration_method,
            "threshold": tuned_threshold,
            "trained_at": trained_at,
            "feature_names": list(vectorizer.get_feature_names_out()),
        },
        artifact_file,
    )

    return {
        "status": "trained",
        "algorithm": "random_forest",
        "sample_count": len(ordered),
        "positive_rate": positive_rate,
        "metrics": metrics,
        "raw_metrics": raw_metrics,
        "artifact_relative_path": str(artifact_file.relative_to(artifacts_root)),
        "feature_names": list(vectorizer.get_feature_names_out()),
        "calibration": {"method": calibration_method},
        "threshold": tuned_threshold,
        "contact_recommendations": recommendations,
        "warning": None,
    }


def _extract_hygiene_matrix(samples: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    feature_names = [
        "bias",
        "days_since_event",
        "days_since_send",
        "delivered_not_clicked_ratio",
        "propensity",
    ]

    x = np.array(
        [
            [
                float(row.get("bias", 1.0)),
                float(row.get("days_since_event", 0.0)),
                float(row.get("days_since_send", 0.0)),
                float(row.get("delivered_not_clicked_ratio", 0.0)),
                float(row.get("propensity", 0.0)),
            ]
            for row in samples
        ],
        dtype=np.float64,
    )
    y = np.array([int(row.get("hygiene_label", 0)) for row in samples], dtype=np.int32)
    return x, y, feature_names


def train_hygiene(samples: List[Dict[str, Any]], artifacts_root: Path, trained_at: str) -> Dict[str, Any]:
    if not samples:
        return {
            "status": "no_data",
            "algorithm": "logistic_regression",
            "sample_count": 0,
            "positive_rate": 0.0,
            "metrics": {},
            "artifact_relative_path": None,
            "feature_names": [
                "bias",
                "days_since_event",
                "days_since_send",
                "delivered_not_clicked_ratio",
                "propensity",
            ],
            "coefficients": [0.0, 0.0, 0.0, 0.0, 0.0],
            "base_rate": 0.05,
            "calibration": {"method": "none"},
            "threshold": {"classification": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0},
            "warning": "No hygiene samples were provided",
        }

    x, y, feature_names = _extract_hygiene_matrix(samples)
    positive_rate = float(np.mean(y)) if y.size else 0.0

    if np.unique(y).size < 2:
        if positive_rate <= 0.0 or positive_rate >= 1.0:
            bias = 0.0
        else:
            bias = float(math.log(positive_rate / (1.0 - positive_rate)))

        coefficients = [bias, 0.0, 0.0, 0.0, 0.0]
        return {
            "status": "single_class",
            "algorithm": "logistic_regression",
            "sample_count": int(y.size),
            "positive_rate": positive_rate,
            "metrics": {},
            "artifact_relative_path": None,
            "feature_names": feature_names,
            "coefficients": coefficients,
            "base_rate": positive_rate,
            "calibration": {"method": "none"},
            "threshold": {"classification": 0.5, "precision": 0.0, "recall": 0.0, "f1": 0.0},
            "warning": "Hygiene dataset has only one target class",
        }

    train_end, cal_end = _split_points(int(y.size))
    x_train = x[:train_end]
    y_train = y[:train_end]
    x_cal = x[train_end:cal_end]
    y_cal = y[train_end:cal_end]
    x_test = x[cal_end:]
    y_test = y[cal_end:]

    if x_cal.shape[0] == 0:
        x_cal = x_train[-1:]
        y_cal = y_train[-1:]
    if x_test.shape[0] == 0:
        x_test = x_cal
        y_test = y_cal

    model = LogisticRegression(
        fit_intercept=False,
        class_weight="balanced",
        max_iter=900,
        solver="lbfgs",
        random_state=42,
    )
    model.fit(x_train, y_train)

    y_prob_cal_raw = model.predict_proba(x_cal)[:, 1]
    calibrator, calibration_method = _fit_calibrator(y_cal, y_prob_cal_raw)
    y_prob_calibrated = _apply_calibrator(calibrator, y_prob_cal_raw)
    tuned_threshold = _tune_threshold(y_cal, y_prob_calibrated)

    y_prob_test_raw = model.predict_proba(x_test)[:, 1]
    y_prob_test_calibrated = _apply_calibrator(calibrator, y_prob_test_raw)
    metrics = _safe_probability_metrics(
        y_test, y_prob_test_calibrated, threshold=tuned_threshold["threshold"]
    )
    raw_metrics = _safe_probability_metrics(y_test, y_prob_test_raw, threshold=0.5)

    coefficients = model.coef_[0].tolist()

    artifact_dir = artifacts_root / "hygiene_real_v1" / trained_at.replace(":", "-")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / "model.joblib"

    joblib.dump(
        {
            "model": model,
            "trained_at": trained_at,
            "feature_names": feature_names,
            "coefficients": coefficients,
            "base_rate": positive_rate,
            "calibrator": calibrator,
            "calibration_method": calibration_method,
            "threshold": tuned_threshold,
        },
        artifact_file,
    )

    return {
        "status": "trained",
        "algorithm": "logistic_regression",
        "sample_count": int(y.size),
        "positive_rate": positive_rate,
        "metrics": metrics,
        "raw_metrics": raw_metrics,
        "artifact_relative_path": str(artifact_file.relative_to(artifacts_root)),
        "feature_names": feature_names,
        "coefficients": coefficients,
        "base_rate": positive_rate,
        "calibration": {"method": calibration_method},
        "threshold": tuned_threshold,
        "warning": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train real ML models for send-time and hygiene scoring")
    parser.add_argument("--artifacts-dir", required=True, help="Artifacts root directory")
    args = parser.parse_args()

    payload = json.load(sys.stdin)
    send_time_samples = payload.get("send_time_samples", [])
    send_time_contact_samples = payload.get("send_time_contact_samples", [])
    hygiene_samples = payload.get("hygiene_samples", [])

    trained_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    artifacts_root = Path(args.artifacts_dir).resolve()
    artifacts_root.mkdir(parents=True, exist_ok=True)

    send_time_result = train_send_time(
        send_time_samples, send_time_contact_samples, artifacts_root, trained_at
    )
    hygiene_result = train_hygiene(hygiene_samples, artifacts_root, trained_at)

    result = {
        "trained_at": trained_at,
        "send_time": send_time_result,
        "hygiene": hygiene_result,
    }

    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
