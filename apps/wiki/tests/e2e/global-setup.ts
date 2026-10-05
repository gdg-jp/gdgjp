import { TEST_PAGE, USERS, prepareE2EState } from "./setup";

export { TEST_PAGE, USERS };

export default async function globalSetup() {
  prepareE2EState();
}
