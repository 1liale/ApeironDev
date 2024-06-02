/**
 * Interface representing the data required for a code execution or submission process.
 */
export interface CodeData {
  // The code to be executed or submitted.
  code: string;

  // The stdin args that can be passed alongside the code.
  stdin: string;

  // A flag indicating whether the code should be submitted or simply executed.
  isSubmit: boolean;
}
