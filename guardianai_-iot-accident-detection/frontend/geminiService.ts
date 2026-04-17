export const analyzeSafetyStatus = async (data: any) => {
  const response = await fetch("http://127.0.0.1:5000/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      acc_x: data.accelerometer_x,
      acc_y: data.accelerometer_y,
      acc_z: data.accelerometer_z,
      gyro_x: data.gyroscope_x,
      gyro_y: data.gyroscope_y,
      gyro_z: data.gyroscope_z,
      speed: data.vehicle_speed,
      vibration: data.vibration_level
    })
  });

  const result = await response.json();

  let status = "Normal";
  if (result.prediction === 1) status = "Minor Accident";
  if (result.prediction === 2) status = "Severe Accident";

  return {
    status,
    confidence_score: 95,
    recommended_action:
      result.prediction === 2
        ? "Call emergency services immediately!"
        : result.prediction === 1
        ? "Check vehicle condition"
        : "All systems normal",
    emergency_alert: result.prediction === 2
  };
};