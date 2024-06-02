import axios from "axios";
import { CodeData } from "../models/data";

const API_URL = "http://localhost:8000";

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const handleRunCode = async (data: CodeData) => {
  try {
    const response = await api.post("/runcode", data);
    return response.data;
  } catch (error) {
    console.error("Error posting to /runcode endpoint:", error);
    throw error;
  }
};
