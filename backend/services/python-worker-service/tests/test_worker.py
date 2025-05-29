import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import subprocess
import os

import worker
from models import CodeExecutionResult

# Set a default project ID for testing if GOOGLE_CLOUD_PROJECT is not set
if not os.getenv("GOOGLE_CLOUD_PROJECT"):
    os.environ["GOOGLE_CLOUD_PROJECT"] = "test-project-pytest"

client = TestClient(worker.app)

@pytest.fixture
def mock_subprocess_run_fixture():
    with patch('subprocess.run') as mock_run:
        yield mock_run

@pytest.fixture
def mock_save_to_gcs_fixture():
    with patch.object(worker, 'save_output_to_gcs') as mock_save:
        yield mock_save

# --- Unit Tests for execute_python_code --- 

@patch('subprocess.run')
def test_execute_python_code_success(mock_subprocess_run):
    mock_process = MagicMock(spec=subprocess.CompletedProcess)
    mock_process.returncode = 0
    mock_process.stdout = "Hello World\n"
    mock_process.stderr = ""
    mock_subprocess_run.return_value = mock_process

    result = worker.execute_python_code("job_success", "print('Hello World')", "")
    assert result.status_code == 0
    assert result.output == "Hello World\n"
    assert result.error is None
    mock_subprocess_run.assert_called_once()

@patch('subprocess.run')
def test_execute_python_code_runtime_error(mock_subprocess_run):
    mock_process = MagicMock(spec=subprocess.CompletedProcess)
    mock_process.returncode = 1
    mock_process.stdout = ""
    mock_process.stderr = "NameError: name 'x' is not defined"
    mock_subprocess_run.return_value = mock_process

    result = worker.execute_python_code("job_runtime_error", "print(x)", "")
    assert result.status_code == 1
    assert result.output == ""
    assert "NameError" in result.error

@patch('subprocess.run')
def test_execute_python_code_timeout(mock_subprocess_run):
    mock_subprocess_run.side_effect = subprocess.TimeoutExpired(cmd=['python3', '-c', 'code'], timeout=worker.DEFAULT_EXECUTION_TIMEOUT_SEC)
    
    result = worker.execute_python_code("job_timeout", "import time; time.sleep(10)", "")
    assert result.status_code == 2
    assert f"timed out after {worker.DEFAULT_EXECUTION_TIMEOUT_SEC} seconds" in result.error.lower()

@patch('subprocess.run')
def test_execute_python_code_internal_failure(mock_subprocess_run):
    mock_subprocess_run.side_effect = OSError("Subprocess launch failed") # More specific than generic Exception

    result = worker.execute_python_code("job_internal_fail", "print('hello')", "")
    assert result.status_code == 3
    assert "unexpected server error" in result.error.lower()

# --- Tests for FastAPI Endpoints ---

def test_health_check_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "Python worker is healthy"}

def test_execute_task_endpoint_success_path(mock_subprocess_run_fixture, mock_save_to_gcs_fixture):
    mock_process = MagicMock(spec=subprocess.CompletedProcess)
    mock_process.returncode = 0
    mock_process.stdout = "Success output"
    mock_subprocess_run_fixture.return_value = mock_process

    payload = {"job_id": "ep_success", "code": "print('ok')", "input_data": ""}
    response = client.post("/execute", json=payload)
    
    assert response.status_code == 200
    json_response = response.json()
    assert json_response["job_id"] == "ep_success"
    assert json_response["execution_status_code"] == 0
    assert "Success output" in json_response["output_snippet"]
    mock_save_to_gcs_fixture.assert_called_once()
    # Assert that execute_python_code was called correctly by the endpoint
    mock_subprocess_run_fixture.assert_called_once_with(
        ['python3', '-c', payload["code"]],
        input=payload["input_data"],
        text=True,
        timeout=worker.DEFAULT_EXECUTION_TIMEOUT_SEC,
        capture_output=True,
        preexec_fn=worker.set_execution_limits
    )

def test_execute_task_endpoint_execution_produces_runtime_error(mock_subprocess_run_fixture, mock_save_to_gcs_fixture):
    mock_process = MagicMock(spec=subprocess.CompletedProcess)
    mock_process.returncode = 1 # User code error
    mock_process.stdout = ""
    mock_process.stderr = "User code syntax error"
    mock_subprocess_run_fixture.return_value = mock_process

    payload = {"job_id": "ep_user_err", "code": "print(x)", "input_data": ""}
    response = client.post("/execute", json=payload)

    assert response.status_code == 200 # Endpoint itself is fine
    json_response = response.json()
    assert json_response["execution_status_code"] == 1
    assert "User code syntax error" in json_response["error_snippet"]
    mock_save_to_gcs_fixture.assert_called_once()

def test_execute_task_endpoint_execution_internal_error(mock_subprocess_run_fixture, mock_save_to_gcs_fixture):
    # This simulates an error within execute_python_code itself (e.g., subprocess.run fails unexpectedly)
    mock_subprocess_run_fixture.side_effect = OSError("Failed to start subprocess")

    payload = {"job_id": "ep_internal_err", "code": "print('hello')", "input_data": ""}
    response = client.post("/execute", json=payload)

    assert response.status_code == 500 # Endpoint should return 500
    json_response = response.json()
    assert "Internal error during code execution" in json_response["detail"]
    # save_output_to_gcs is called because execute_python_code returns a result with status_code=3
    mock_save_to_gcs_fixture.assert_called_once()
    # Check that the GCS save was attempted with the correct error status
    args, _ = mock_save_to_gcs_fixture.call_args
    saved_result: CodeExecutionResult = args[1]
    assert saved_result.status_code == 3
    assert "unexpected server error" in saved_result.error.lower() 