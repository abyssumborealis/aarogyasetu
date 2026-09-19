from __future__ import annotations
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from src.crowd_model import NUMERIC as CROWD_NUM
from src.crowd_model import CATEGORICAL as CROWD_CAT
from src.crowd_model import save_model as save_crowd
from src.crowd_model import train_crowd_model
from src.data_generator import save_dataset
from src.eta_model import NUMERIC as ETA_NUM
from src.eta_model import CATEGORICAL as ETA_CAT
from src.eta_model import save_model as save_eta
from src.eta_model import train_eta_model
from src.feature_engineering import create_ml_feature_table
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MODELS = ROOT / "models"
def metrics(y_true, y_pred) -> dict:
    rmse = mean_squared_error(y_true, y_pred) ** 0.5
    return {
        "MAE": round(float(mean_absolute_error(y_true, y_pred)), 3),
        "RMSE": round(float(rmse), 3),
        "R2": round(float(r2_score(y_true, y_pred)), 3),
    }
def feature_importance_plot(pipeline, numeric, categorical, title: str, outfile: Path) -> None:
    pre = pipeline.named_steps["pre"]
    rf = pipeline.named_steps["rf"]
    cat_names = list(pre.named_transformers_["cat"].get_feature_names_out(categorical))
    names = list(numeric) + cat_names
    importances = rf.feature_importances_
    order = importances.argsort()[::-1][:12]
    plt.figure(figsize=(8, 4.5))
    plt.barh([names[i] for i in order][::-1], importances[order][::-1], color="#0f766e")
    plt.title(title)
    plt.tight_layout()
    outfile.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(outfile, dpi=120)
    plt.close()
def main() -> None:
    print("Generating synthetic data...")
    data = save_dataset(DATA)
    print(f"Registrations: {len(data['registrations'])}")
    feat = create_ml_feature_table(data["registrations"])
    feat.to_csv(DATA / "module1_features.csv", index=False)
    print(f"Module 1 feature rows: {len(feat)}")
    crowd = data["crowd"]
    eta = data["eta"]
    c_train, c_test = train_test_split(crowd, test_size=0.2, random_state=42)
    crowd_model = train_crowd_model(c_train)
    c_pred = crowd_model.predict(c_test[CROWD_NUM + CROWD_CAT])
    crowd_scores = metrics(c_test["crowd_count"], c_pred)
    print("Crowd model:", crowd_scores)
    e_train, e_test = train_test_split(eta, test_size=0.2, random_state=42)
    eta_model = train_eta_model(e_train)
    e_pred = eta_model.predict(e_test[ETA_NUM + ETA_CAT])
    eta_scores = metrics(e_test["waiting_time_minutes"], e_pred)
    print("ETA model:", eta_scores)
    save_crowd(crowd_model, MODELS / "crowd_model.pkl")
    save_eta(eta_model, MODELS / "eta_model.pkl")
    feature_importance_plot(
        crowd_model, CROWD_NUM, CROWD_CAT, "Crowd model feature importance", MODELS / "crowd_importance.png"
    )
    feature_importance_plot(
        eta_model, ETA_NUM, ETA_CAT, "ETA model feature importance", MODELS / "eta_importance.png"
    )
    report = [
        "Hospital Queue ML evaluation",
        f"Registrations generated: {len(data['registrations'])}",
        f"Crowd rows: {len(crowd)}  ETA rows: {len(eta)}",
        f"Crowd MAE={crowd_scores['MAE']} RMSE={crowd_scores['RMSE']} R2={crowd_scores['R2']}",
        f"ETA   MAE={eta_scores['MAE']} RMSE={eta_scores['RMSE']} R2={eta_scores['R2']}",
        "Models saved to ml/models/",
    ]
    (MODELS / "evaluation_report.txt").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))
if __name__ == "__main__":
    main()
