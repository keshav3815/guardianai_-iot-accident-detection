import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
import pickle

# Load dataset
data = pd.read_csv("sensor_raw.csv")
data = data.dropna()
data.columns = [col.strip().lower() for col in data.columns]

# Actual CSV schema: target(class), gyrox, gyroy, gyroz, accx, accy, accz
# Only these 6 sensor columns exist in the dataset -- there is no speed/vibration
# data here, so the model is trained (and served) on exactly these 6 features.
FEATURE_COLUMNS = ["accx", "accy", "accz", "gyrox", "gyroy", "gyroz"]
X = data[FEATURE_COLUMNS]

# target(class) (raw values 1-4) is NOT used: it is undocumented and, when
# checked against the sensor magnitudes, does not correlate with an ordinal
# severity scale (e.g. acc/gyro ranges overlap heavily across all 4 classes).
# Guessing a mapping onto Normal/Minor/Severe from it would silently produce a
# model whose "Severe" predictions don't actually correspond to large sensor
# deviations -- worse than not using it.
#
# Instead we derive physically-grounded labels from the sensor readings
# themselves: combine accelerometer magnitude (deviation from resting ~1g)
# with gyroscope magnitude (scaled down since it's on a much larger range),
# then bucket by percentile of that combined score so the split stays
# balanced regardless of the dataset's absolute units.
acc_mag = np.sqrt(X["accx"] ** 2 + X["accy"] ** 2 + X["accz"] ** 2)
gyro_mag = np.sqrt(X["gyrox"] ** 2 + X["gyroy"] ** 2 + X["gyroz"] ** 2)
severity_score = acc_mag + gyro_mag / 10

minor_threshold = severity_score.quantile(0.70)
severe_threshold = severity_score.quantile(0.90)


def classify(score):
    if score > severe_threshold:
        return 2  # Severe
    elif score > minor_threshold:
        return 1  # Minor
    return 0  # Normal


y = severity_score.apply(classify)

print("Training feature shape:", X.shape)
print(f"Thresholds -- minor: {minor_threshold:.3f}, severe: {severe_threshold:.3f}")
print("Label distribution:\n", y.value_counts().sort_index())

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

model = RandomForestClassifier(random_state=42)
model.fit(X_train, y_train)

print("Accuracy:", model.score(X_test, y_test))
print(classification_report(y_test, model.predict(X_test)))

# Persist the model together with the exact feature order it was trained on,
# so the serving code (app.py) can never silently drift out of sync with it.
with open("model.pkl", "wb") as f:
    pickle.dump({"model": model, "features": FEATURE_COLUMNS}, f)
