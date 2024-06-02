import CodeEditor from "./components/CodeEditor";

export default function App() {
  return (
    <div className="p-16 w-full min-h-screen bg-gray-800">
      <div className="flex flex-col items-center gap-2">
        <div className="title-container text-center p-6">
          <h1 className="text-white text-2xl">
            Python3 Code Execution Environment
          </h1>
          <p className="text-lg text-gray-500 mt-2">
            (Click &quot;Test Code&quot; to run code and &quot;Submit&quot; to
            save code + results)
          </p>
        </div>
        <CodeEditor />
      </div>
    </div>
  );
}
