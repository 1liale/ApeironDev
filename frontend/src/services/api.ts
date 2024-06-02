import axios from "axios";
import { CodeData } from "../models/data";

const API_URL = "http://localhost:8000";

// Creating an instance of axios
const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Function to handle running code by making a POST request to the /runcode endpoint.
 * @param data - An object containing the source code, stdin args, and isSubmit flag.
 * @returns The response data from the API call.
 * @throws Will throw an error if the API call fails.
 */
export const handleRunCode = async (data: CodeData) => {
  try {
    const response = await api.post("/runcode", data);
    return response.data;
  } catch (error) {
    console.error("Error posting to /runcode endpoint:", error);
  }
};
