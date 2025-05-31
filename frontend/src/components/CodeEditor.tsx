import { Editor } from "@monaco-editor/react";
import React, { useState } from "react";
import { Button } from "@nextui-org/button";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { executeCode } from "../services/api";
import { CodeData } from "../models/data";

const CodeEditor = () => {
  const defaultEditorMsg =
    "# write your code here (pandas and scipy are available to use)";

  const [codeVal, setCodeVal] = useState(defaultEditorMsg);
  const [result, setResult] = useState("");
  const [input, setInput] = useState("");

  // handles button clicks to test or submit code
  const handleClick = async (isSubmit: boolean) => {
    try {
      const data: CodeData = {
        code: codeVal,
        language: "python",
        input: input,
      };
      const res = await executeCode(data);
      setResult(res.result); // sets result of the execution
      if (res.status != 0) throw Error(res.result); // handles invalid executions
      if (isSubmit) toast.success("Submitted!"); // toasts successful submissions
    } catch (error) {
      console.error(error);
      toast.error("Failed to submit!");
    }
  };

  return (
    <div className="editor-content flex flex-col w-3/4 gap-4">
      <div className="code-content flex w-full overflow-x-auto">
        <Editor
          height="50vh"
          theme="vs-dark"
          defaultLanguage="python"
          defaultValue={defaultEditorMsg}
          value={codeVal}
          onChange={(value) => setCodeVal(value!)}
        />
        <textarea
          className="text-sm p-2 min-w-[200px] w-1/3 overflow-auto resize-none"
          value={"Execution Result:\n" + result}
          readOnly
        />
      </div>
      <textarea
        className="text-sm text-white p-2 rounded border-2 bg-gray-700 border-gray-700 hover:border-gray-300 resize-none"
        placeholder="Pass stdin args here..."
        onChange={(e) => setInput(e.target.value)}
        value={input}
      />
      <div className="button-row flex justify-end gap-4 ">
        <ToastContainer position="bottom-right" theme="dark" autoClose={3000} />
        <Button
          className="text-white"
          color="warning"
          variant="shadow"
          onClick={() => handleClick(false)}
        >
          Test Code
        </Button>
        <Button
          className="text-white"
          color="primary"
          variant="shadow"
          onClick={() => handleClick(true)}
        >
          Submit
        </Button>
      </div>
    </div>
  );
};

export default CodeEditor;
