export function createBuildCheckOps() {
  async function doBuildCheck() {}
  async function prePushBuildCheck() {
    return true;
  }
  return { doBuildCheck, prePushBuildCheck };
}
