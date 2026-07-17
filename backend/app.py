import os
import re
import logging
import pickle

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Restrict CORS to local dev origins instead of allowing "*". Matched by regex
# (any port) rather than a fixed port, because Vite auto-increments to the
# next free port (3001, 3002, ...) whenever 3000 is already taken -- a fixed
# allowlist would silently break the frontend->backend calls in that case.
# Add your deployed frontend's real origin here when you ship beyond localhost.
CORS(app, origins=[re.compile(r"^https?://(localhost|127\.0\.0\.1):\d+$")])

with open("model.pkl", "rb") as f:
    saved = pickle.load(f)
model = saved["model"]
FEATURE_COLUMNS = saved["features"]  # e.g. ["accx", "accy", "accz", "gyrox", "gyroy", "gyroz"]

# Maps each trained feature name to the accepted request field names (frontend
# style first, dataset style as a fallback), so /predict keeps working
# regardless of which naming convention the caller uses.
FIELD_ALIASES = {
    "accx": ["accelerometer_x", "acc_x"],
    "accy": ["accelerometer_y", "acc_y"],
    "accz": ["accelerometer_z", "acc_z"],
    "gyrox": ["gyroscope_x", "gyro_x"],
    "gyroy": ["gyroscope_y", "gyro_y"],
    "gyroz": ["gyroscope_z", "gyro_z"],
}


@app.route("/")
def home():
    return "Backend is running 🚀"


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    row = []
    missing = []
    for feature in FEATURE_COLUMNS:
        aliases = FIELD_ALIASES.get(feature, [feature])
        value = None
        for key in aliases:
            if key in data:
                value = data[key]
                break
        if value is None:
            missing.append(feature)
            continue
        try:
            row.append(float(value))
        except (TypeError, ValueError):
            return jsonify({"error": f"Field for '{feature}' must be numeric"}), 400

    if missing:
        return jsonify({"error": f"Missing required fields for: {missing}"}), 400

    features = np.array([row], dtype=float)
    logger.info("Predicting on features %s", features.tolist())

    try:
        prediction = model.predict(features)[0]
    except Exception:
        logger.exception("Model prediction failed")
        return jsonify({"error": "Prediction failed"}), 500

    return jsonify({"prediction": int(prediction)})


if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode)
