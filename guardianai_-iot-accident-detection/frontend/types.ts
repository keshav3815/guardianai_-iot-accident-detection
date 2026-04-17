
export interface SensorData {
  accelerometer_x: number;
  accelerometer_y: number;
  accelerometer_z: number;
  gyroscope_x: number;
  gyroscope_y: number;
  gyroscope_z: number;
  vibration_level: number;
  vehicle_speed: number;
  gps_latitude: number;
  gps_longitude: number;
  timestamp: string;
}

export enum DetectionStatus {
  Normal = "Normal Driving",
  Minor = "Minor Impact",
  Severe = "Severe Accident"
}

export interface AIResponse {
  status: DetectionStatus;
  confidence_score: number;
  emergency_alert: boolean;
  send_location?: boolean;
  recommended_action: string;
  explanation?: string;
}

export interface HistoryItem {
  id: string;
  data: SensorData;
  result: AIResponse;
  timestamp: string;
}

export interface User {
  name: string;
  email: string;
  avatar?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  category: 'SYSTEM' | 'NEWS' | 'WORK';
  content: string;
  date: string;
}
