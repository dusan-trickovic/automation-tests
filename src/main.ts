import * as core from "@actions/core";
import * as semver from "semver";
import * as dotenv from "dotenv";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";


async function main() {

    const NODE_API_ENDPOINT = 'https://endoflife.date/api/node.json';
    const PYTHON_API_ENDPOINT = 'https://endoflife.date/api/python.json';

    // UNCOMMENT THE LINE BELOW WHEN THE LOGIC FOR GO IS READY
    // const GO_API_ENDPOINT = 'https://endoflife.date/api/go.json';

    const testNodeManifestRepoData = {
        owner: 'actions',
        repo: 'node-versions',
        path: 'versions-manifest.json'
    }

    const testPythonManifestRepoData = {
        owner: 'actions',
        repo: 'python-versions',
        path: 'versions-manifest.json'
    }

    // UNCOMMENT THE LINE BELOW WHEN THE LOGIC FOR GO IS READY
    // const testGoManifestRepoData = {
    //     owner: 'actions',
    //     repo: 'go-versions',
    //     path: 'versions-manifest.json'
    // }

    // Modify the owner and repo values to test the action on a different repo.
    // Also make sure to generate a new PAT for the workflow to work properly.
    const testBasicRepoData = {
        owner: 'dusan-trickovic',
        repo: 'automation-tests'
    }

    try {
        await checkNodeAndPythonVersions(ToolName.Node, NODE_API_ENDPOINT, testNodeManifestRepoData, testBasicRepoData);
        await checkNodeAndPythonVersions(ToolName.Python, PYTHON_API_ENDPOINT, testPythonManifestRepoData, testBasicRepoData);
        
        // UNCOMMENT THE LINE BELOW WHEN THE LOGIC FOR GO IS READY
        // await checkToolVersion(ToolName.Go, GO_API_ENDPOINT, testGoManifestRepoData, testBasicRepoData);
    } catch (error) {
        core.setFailed((error as Error).message);
    }

}

interface GithubFileContent {
    content: string;
}

interface IBasicRepoData {
    owner: string;
    repo: string;
}

interface IManifestRepoData extends IBasicRepoData {
    path: string;
}

enum ToolName {
    Node = "Node",
    Python = "Python",
    Go = "Go",
}


dotenv.config();

function compareDates(date: string): boolean {
    const currentDate = new Date().toISOString().split('T')[0];
    return date >= currentDate;
}

function isMoreThanSixMonthsApart(givenDate: Date): boolean {
    const currentDate = new Date();
    const timeDifferenceMs = givenDate.getTime() - currentDate.getTime();
    const monthsDifference = Math.floor(timeDifferenceMs / (1000 * 60 * 60 * 24 * 30));
    const yearsDifference = Math.floor(monthsDifference / 12);    
    return yearsDifference > 0 || monthsDifference > 6;
  }

const octokit = new Octokit({ 
    auth: `${process.env.PERSONAL_ACCESS_TOKEN}`,
    request: {
        fetch: fetch,
    },
});

export async function fetchJsonData(url: string) {
    const response = await fetch(url);
    const data: any = await response.json();
    return data;
}

export async function filterApiData(data: any[], toolName: null | "Go" = null) {
    let filteredData;
    if (toolName === "Go") {
        filteredData = data.filter((item: any) => { 
            return item.eol !== false;
        });
        return filteredData;
    }
    filteredData = data.filter((item: any) => {
        const eolDate = new Date(item.eol);
        return compareDates(eolDate.toISOString().split('T')[0]);
    }).reverse();

    return filteredData;
}

async function getVersionsManifestFromRepo(manifestRepoData: IManifestRepoData, referenceVersion: string) {
    try {   
        const response = await octokit.repos.getContent({
        owner: manifestRepoData.owner,
        repo:  manifestRepoData.repo,
        path:  manifestRepoData.path,
        });

        const githubFileContent = response.data as GithubFileContent;
        const content = Buffer.from(githubFileContent.content, 'base64').toString();
        const jsonData = JSON.parse(content);
        const reversedJsonData = jsonData.reverse();
        const latestFromManifest = reversedJsonData.filter((item: any) => {
            return semver.gte(item.version, referenceVersion);
        });

        return latestFromManifest;
    } catch (error) {
        core.setFailed((error as Error).message);
        return [];
    }
}

interface IIssueContent {
    title: string;
    body: string;
    labels: string[];
}

async function createIssueOnInternalRepo(
    toolName: ToolName,
    earliestVersionFromApi: string,
    basicRepoData: IBasicRepoData,
    issueContent: IIssueContent
) {
    const { owner, repo } = basicRepoData;
    const { title, body, labels } = issueContent;
        core.warning(`Creating an issue in the ${owner}/${repo} repo...\n`);
        try {
            await octokit.issues.create({
                owner,
                repo,
                title,
                body,
                labels
            });
            const successMessage = `Successfully created an issue for ${toolName} version ${earliestVersionFromApi}.\n`;
            core.info(successMessage);
            return;
        } catch (error) {
            const errorMessage = (error as Error).message;
            core.setFailed("Error while creating an issue: " + errorMessage);
        }
}

async function checkNodeAndPythonVersions(
    toolName: ToolName,
    apiEndpoint: string,
    manifestRepoData: IManifestRepoData,
    basicRepoData: IBasicRepoData,
) {
    const toolVersionsFromApi = await fetchJsonData(apiEndpoint);
    const filteredToolVersionsFromApi = await filterApiData(toolVersionsFromApi);
    const earliestVersionFromApi = filteredToolVersionsFromApi[0].latest;

    core.info(`\n ${toolName} version: ${earliestVersionFromApi}`);
    const latestFromManifest = await getVersionsManifestFromRepo(manifestRepoData, earliestVersionFromApi);
    const earliestVersionInManifest = latestFromManifest[0].version;

    if (!semver.gte(earliestVersionFromApi, earliestVersionInManifest)) {
        core.info(`The earliest version of ${toolName} does not match the one in the manifest.\n`);
        core.warning(`The earliest version of ${toolName} is ${earliestVersionFromApi} and the one in the manifest is ${earliestVersionInManifest}.`);
        const issueContent = {
            title: `[AUTOMATIC MESSAGE] ${toolName} version \`${earliestVersionFromApi}\` is not in the manifest`,
            body:  `Hello :wave:
                    The earliest version of ${toolName} is \`${earliestVersionFromApi}\` and the one in the manifest is \`${earliestVersionInManifest}\`. Please consider updating the manifest.`,
            labels: ['manifest-version-mismatch'],
        }

        createIssueOnInternalRepo(toolName, earliestVersionFromApi, basicRepoData, issueContent);
    }

    core.info(`The earliest version of ${toolName} matches the one in the manifest. Checking the EOL support date...\n`);

    if (isMoreThanSixMonthsApart(new Date(filteredToolVersionsFromApi[0].eol))) {
        core.info(`The version ${earliestVersionFromApi} has more than 6 months left before EOL. It will reach its EOL date on ${filteredToolVersionsFromApi[0].eol} \n`);
        return;
    }

    if (isMoreThanSixMonthsApart(new Date(filteredToolVersionsFromApi[0].eol)) === false) {
        const earliestVersionFromApiEol = filteredToolVersionsFromApi[0].eol;
        const issueContent = {
            title: `[AUTOMATIC MESSAGE] ${toolName} version \`${earliestVersionFromApi}\` is losing support on ${earliestVersionFromApiEol}`,
            body:  `Hello :wave: 
                    The support for ${toolName} version \`${earliestVersionFromApi}\` is ending on ${earliestVersionFromApi}. Please consider upgrading to a newer version of ${toolName}.`,
            labels: ['deprecation-notice'],
        }
        createIssueOnInternalRepo(toolName, earliestVersionFromApi, basicRepoData, issueContent);
        return;
    }

    core.setFailed(" The version " + earliestVersionFromApi + " is no longer supported. It has reached its EOL date on " + filteredToolVersionsFromApi[0].eol + ".");

}

main();