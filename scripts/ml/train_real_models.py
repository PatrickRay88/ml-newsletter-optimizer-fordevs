#!/usr/bin/env python3
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
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
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


def _safe_probability_metrics(y_true: np.ndarray, y_prob: np.ndarray) -> Dict[str, Any]:
    metrics: Dict[str, Any] = {}
    y_pred = (y_prob >= 0.5).astype(int)

    metrics["accuracy"] = float(accuracy_score(y_true, y_pred))
    try:
        metrics["auc"] = float(roc_auc_score(y_true, y_prob))
    except ValueError:
        metrics["auc"] = None

    try:
        metrics["pr_auc"] = float(average_precision_score(y_true, y_prob))
    except ValueError:
        metrics["pr_auc"] = None

    try:
        metrics["log_loss"] = float(log_loss(y_true, y_prob, labels=[0, 1]))
    except ValueError:
        metrics["log_loss"] = None

    try:
        metrics["brier_score"] = float(brier_score_loss(y_true, y_prob))
    except ValueError:
        metrics["brier_score"] = None

    return metrics


def _split_point(count: int, test_ratio: float = 0.2) -> int:
    if count <= 1:
        return count
    split = int(count * (1.0 - test_ratio))
    split = max(1, min(count - 1, split))
    return split


def _extract_send_time_features(sample: Dict[str, Any]) -> Dict[str, Any]:
    ignore = {"clicked", "sent_at", "message_id"}
    return {key: value for key, value in sample.items() if key not in ignore}


def train_send_time(samples: List[Dict[str, Any]], artifacts_root: Path, trained_at: str) -> Dict[str, Any]:
    if not samples:
        return {
            "status": "no_data",
            "algorithm": "random_forest",
            "sample_count": 0,
            "positive_rate": 0.0,
            "metrics": {},
            "artifact_relative_path": None,
            "feature_names": [],
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
            "warning": "Send-time dataset has only one target class",
        }

    split = _split_point(len(ordered), 0.2)
    train_rows = ordered[:split]
    test_rows = ordered[split:]

    vectorizer = DictVectorizer(sparse=False)
    x_train = vectorizer.fit_transform([_extract_send_time_features(row) for row in train_rows])
    y_train = np.array([int(row.get("clicked", 0)) for row in train_rows], dtype=np.int32)

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

    y_prob = model.predict_proba(x_test)[:, 1]
    metrics = _safe_probability_metrics(y_test, y_prob)

    artifact_dir = artifacts_root / "send_time_real_v1" / trained_at.replace(":", "-")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / "model.joblib"

    joblib.dump(
        {
            "vectorizer": vectorizer,
            "model": model,
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
        "artifact_relative_path": str(artifact_file.relative_to(artifacts_root)),
        "feature_names": list(vectorizer.get_feature_names_out()),
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
            "warning": "Hygiene dataset has only one target class",
        }

    split = _split_point(int(y.size), 0.2)
    x_train = x[:split]
    y_train = y[:split]
    x_test = x[split:]
    y_test = y[split:]

    model = LogisticRegression(
        fit_intercept=False,
        class_weight="balanced",
        max_iter=900,
        solver="lbfgs",
        random_state=42,
    )
    model.fit(x_train, y_train)

    y_prob = model.predict_proba(x_test)[:, 1]
    metrics = _safe_probability_metrics(y_test, y_prob)

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
        },
        artifact_file,
    )

    return {
        "status": "trained",
        "algorithm": "logistic_regression",
        "sample_count": int(y.size),
        "positive_rate": positive_rate,
        "metrics": metrics,
        "artifact_relative_path": str(artifact_file.relative_to(artifacts_root)),
        "feature_names": feature_names,
        "coefficients": coefficients,
        "base_rate": positive_rate,
        "warning": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train real ML models for send-time and hygiene scoring")
    parser.add_argument("--artifacts-dir", required=True, help="Artifacts root directory")
    args = parser.parse_args()

    payload = json.load(sys.stdin)
    send_time_samples = payload.get("send_time_samples", [])
    hygiene_samples = payload.get("hygiene_samples", [])

    trained_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    artifacts_root = Path(args.artifacts_dir).resolve()
    artifacts_root.mkdir(parents=True, exist_ok=True)

    send_time_result = train_send_time(send_time_samples, artifacts_root, trained_at)
    hygiene_result = train_hygiene(hygiene_samples, artifacts_root, trained_at)

    result = {
        "trained_at": trained_at,
        "send_time": send_time_result,
        "hygiene": hygiene_result,
    }

    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
