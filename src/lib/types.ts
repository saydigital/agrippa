export type CrmWorkflow = {
  name: string;
  id: number;
};

export type CrmPhase = {
  name: string;
  id: number;
  code: string;
  set_result_automatically: 'from_code' | string;
  __last_update: string;
  write_date: string;
};

export type ModelFunctionAccess = {
  id: number;
  name: string;
  model_name: string;
  code: string;
  write_date: string;
};
