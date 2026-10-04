export type ProfileRow = {
  user_id: string;
  legal_name: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number_enc: string;
  updated_at: number;
};

export type BankAccount = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
};

export type DecryptedProfile = {
  userId: string;
  legalName: string;
  bank: BankAccount;
  updatedAt: number;
};
