import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
import pickle

# Load dataset


data = pd.read_csv("sensor_raw.csv")

# Remove missing values
data = data.dropna()

# Rename columns (adjust based on dataset if needed)
# Example assumes columns like acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z
# If names differ, update accordingly
data.columns = [col.lower() for col in data.columns]

# Create synthetic labels based on thresholds
def classify(row):
    acc = abs(row.iloc[0]) + abs(row.iloc[1]) + abs(row.iloc[2])
    gyro = abs(row.iloc[3]) + abs(row.iloc[4]) + abs(row.iloc[5])
    
    if acc > 20 or gyro > 3:
        return 2   # Severe
    elif acc > 8 or gyro > 1.5:
        return 1   # Minor
    else:
        return 0   # Normal

data["label"] = data.apply(classify, axis=1)

# Features & Labels
# Ensure EXACT 8 features used for both training and prediction
X = data.drop("label", axis=1)


# Select numeric columns
X = X.select_dtypes(include=['number'])

# If dataset has only 7 features, add derived feature to make it 8
if X.shape[1] == 7:
    # Create acceleration magnitude as extra feature
    X["acc_magnitude"] = (X.iloc[:,0]**2 + X.iloc[:,1]**2 + X.iloc[:,2]**2) ** 0.5

# Ensure exactly 8 features
X = X.iloc[:, :8]

# Debug: print feature shape
print("Training feature shape:", X.shape)

y = data["label"]

# Split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Train model
model = RandomForestClassifier()
model.fit(X_train, y_train)

# Accuracy
print("Accuracy:", model.score(X_test, y_test))

# Save model
pickle.dump(model, open("model.pkl", "wb"))