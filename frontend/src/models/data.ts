/**
 * Interface representing the data required for a code execution or submission process.
 */
export interface CodeData {
  // The code to be executed or submitted.
  code: string;

  // The stdin args that can be passed alongside the code.
  input: string;

  // The language of the code to be executed.
  language: string;
}
