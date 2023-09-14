import * as core from '@actions/core';
import {GoTool, NodeTool, PythonTool} from './tool-classes';

async function main() {
  const nodeTool = new NodeTool();
  const pythonTool = new PythonTool();
  const goTool = new GoTool();

  try {
    const promises = [
      nodeTool.checkVersions(),
      pythonTool.checkVersions(),
      goTool.checkVersions()
    ];

    await Promise.all(promises);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}
main();
