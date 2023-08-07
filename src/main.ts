import * as core from "@actions/core";
import * as semver from "semver";
import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";


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


dotenv.config();

function compareDates(date: string): boolean {
    try {
        const currentDate = new Date().toISOString().split('T')[0];
        return date >= currentDate;
    } catch (error) {
        core.setFailed((error as Error).message);
        return false;
    }
}

function isMoreThanSixMonthsApart(givenDate: Date): boolean {
    try {
        const currentDate = new Date();
        const timeDifferenceMs = givenDate.getTime() - currentDate.getTime();
        const monthsDifference = Math.floor(timeDifferenceMs / (1000 * 60 * 60 * 24 * 30));
        const yearsDifference = Math.floor(monthsDifference / 12);    
        return yearsDifference > 0 || monthsDifference > 6;
    } catch (error) {
        core.setFailed((error as Error).message);
        return false;
    }
  }



const octokit = new Octokit({ 
    auth: `${process.env.PERSONAL_ACCESS_TOKEN}`,
});

export async function fetchJsonData(url: string, toolName: null | "Go" = null) {
    try {
        const response = await fetch(url);
        const data: any = await response.json();
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
    } catch (error) {
        core.setFailed((error as Error).message);
        return [];
    }
}

async function getVersionsManifestFromRepo(manifestRepoData: IManifestRepoData, referenceVersion: string) {
    try {
        const octokit = new Octokit({ 
            auth: `${process.env.PERSONAL_ACCESS_TOKEN}`,
            request: {
                fetch: fetch,
            },
        });

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

// Function below applicable only for Node.js and Python
async function checkToolVersion(
    toolName: "Node" | "Python" | "Go",
    apiEndpoint: string,
    manifestRepoData: IManifestRepoData,
    basicRepoData: IBasicRepoData,
) {
    const toolVersionsFromApi = toolName === "Go" ? await fetchJsonData(apiEndpoint, "Go") : await fetchJsonData(apiEndpoint);
    console.log(toolVersionsFromApi[0].latest);
    const latestFromManifest = await getVersionsManifestFromRepo(manifestRepoData, toolVersionsFromApi[0].latest);
    const earliestVersionInManifest = latestFromManifest[0].version;

    if (!semver.gte(toolVersionsFromApi[0].latest, earliestVersionInManifest)) {
        core.info(`The latest version of ${toolName} does not match the one in the manifest. Exiting the program...\n`);
        return;
    }

    core.info(`The latest version of ${toolName} matches the one in the manifest. Checking the EOL support date...\n`);
    
    if (isMoreThanSixMonthsApart(new Date(toolVersionsFromApi[0].eol))) {
        core.info("The version has more than 6 months left before EOL. It will reach its EOL date on " + toolVersionsFromApi[0].eol + "\n");
        return;
    }

    if (isMoreThanSixMonthsApart(new Date(toolVersionsFromApi[0].eol)) === false && compareDates(toolVersionsFromApi[0].eol)) {

        core.warning(` The version ${toolVersionsFromApi[0].latest} has less than 6 months left before EOL. It will reach its EOL date on ${toolVersionsFromApi[0].eol} `);
            

        
        try {
        
            core.info(`Creating an issue for ${toolName} version ${toolVersionsFromApi[0].latest}...\n`);
            await octokit.issues.create({
                owner: basicRepoData.owner,
                repo:  basicRepoData.repo,
                title: `[AUTOMATIC MESSAGE] ${toolName} version \`${toolVersionsFromApi[0].latest}\` is losing support on ${toolVersionsFromApi[0].eol}`,
                body:  `Hello :wave: 
                        The support for ${toolName} version \`${toolVersionsFromApi[0].latest}\` is ending on ${toolVersionsFromApi[0].eol}. Please consider upgrading to a newer version of ${toolName}.`,
                labels: ['deprecation-notice'],
            });

            const successMessage = `Successfully created an issue for ${toolName} version ${toolVersionsFromApi[0].latest}.\n`;
            core.info(successMessage);
            return successMessage;

        } catch (error) {

            const errorMessage = (error as Error).message;
            core.setFailed("Error while creating an issue: " + errorMessage);

        }
    }
    
    core.setFailed(" The version " + toolVersionsFromApi[0].latest + " is no longer supported. It has reached its EOL date on " + toolVersionsFromApi[0].eol + ".");

}


async function main() {

    const nodeApiPoint = 'https://endoflife.date/api/node.json';
    const pythonApiPoint = 'https://endoflife.date/api/python.json';
    const goApiPoint = 'https://endoflife.date/api/go.json';

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

    const testGoManifestRepoData = {
        owner: 'actions',
        repo: 'go-versions',
        path: 'versions-manifest.json'
    }

    // Modify the owner and repo values to test the action on a different repo.
    const testBasicRepoData = {
        owner: 'dusan-trickovic',
        repo: 'automation-tests'
    }

    await checkToolVersion('Node', nodeApiPoint, testNodeManifestRepoData, testBasicRepoData);
    await checkToolVersion('Python', pythonApiPoint, testPythonManifestRepoData, testBasicRepoData);
    await checkToolVersion('Go', goApiPoint, testGoManifestRepoData, testBasicRepoData);

}

main();

// async function test() {
//     const testGoManifestRepoData = {
//         owner: 'actions',
//         repo: 'go-versions',
//         path: 'versions-manifest.json'
//     }

//     const testBasicRepoData = {
//         owner: 'dusan-trickovic',
//         repo: 'automation-tests'
//     }
//     // await checkPythonAndNode('Go', 'https://endoflife.date/api/go.json', testGoManifestRepoData, testBasicRepoData );
//     const data = await fetchGoJsonData();
//     const manifestData = await getVersionsManifestFromRepo(testGoManifestRepoData, data[0].latest);
//     console.log(data);
//     console.log(manifestData);
// }

// test();