from flask import Flask, request, jsonify
import pickle
import numpy as np
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

model = pickle.load(open("model.pkl", "rb"))

@app.route("/")
def home():
    return "Backend is running 🚀"

@app.route("/predict", methods=["POST"])
def predict():
    data = request.json
    
    print("Incoming data:", data)

    # Handle both naming formats (frontend vs dataset)
    features = np.array([[
        data.get("accelerometer_x", data.get("acc_x", 0)),
        data.get("accelerometer_y", data.get("acc_y", 0)),
        data.get("accelerometer_z", data.get("acc_z", 0)),
        data.get("gyroscope_x", data.get("gyro_x", 0)),
        data.get("gyroscope_y", data.get("gyro_y", 0)),
        data.get("gyroscope_z", data.get("gyro_z", 0)),
        data.get("vehicle_speed", data.get("speed", 0)),
        data.get("vibration_level", data.get("vibration", 0))
    ]], dtype=float)

    print("Feature shape:", features.shape)
    
    prediction = model.predict(features)[0]
    
    return jsonify({"prediction": int(prediction)})

if __name__ == "__main__":
    app.run(debug=True)