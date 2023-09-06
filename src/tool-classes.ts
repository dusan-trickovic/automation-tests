import * as semver from 'semver';
import * as core from '@actions/core';
import { calculateSixMonthsFromGivenDate, dateGteCurrentDate, isDateMoreThanSixMonthsApart } from "./utils";
import { BaseRepository, GitHubIssue, ManifestRepository } from './repository-classes';

interface IResponseFormat {
    eol: string;
    latest: string;
    latestReleaseDate: string;
}

abstract class Tool {
    protected name: string;
    protected apiEndpoint: string;
    protected manifestRepository: ManifestRepository;
    protected internalRepository: BaseRepository = new BaseRepository('dusan-trickovic', 'automation-tests');
    constructor(name: string, apiEndpoint: string, manifestRepository: ManifestRepository) {
        this.name = name;
        this.apiEndpoint = apiEndpoint;
        this.manifestRepository = manifestRepository;
    }

    protected async getVersionsFromApi(url: string): Promise<IResponseFormat[]> {
        const response = await fetch(url);
        const data: any = await response.json();
        return data;
    }

    protected async filterApiData(data: IResponseFormat[]) {
        const filteredData = data.filter((item: any) => {
            const eolDate = new Date(item.eol);
            return dateGteCurrentDate(eolDate.toISOString().split('T')[0]);
        }).reverse();    
        return filteredData;
    }

    async checkVersions() {
        const toolVersionsFromApi = await this.getVersionsFromApi(this.apiEndpoint);
        const filteredToolVersionsFromApi = await this.filterApiData(toolVersionsFromApi);
        const earliestVersionFromApi = filteredToolVersionsFromApi[0].latest;
        
        core.info(`\n ${this.name} version: ${earliestVersionFromApi}`);
        core.info(` For more info on ${this.name} versions, please visit: https://endoflife.date/${this.name === 'Node' ? 'nodejs' : 'python' }\n`);
        
        const manifestData = await this.manifestRepository.getVersionsManifestFromRepo(earliestVersionFromApi);
        // const latestFromManifest = await getVersionsManifestFromRepo(manifestRepoData, earliestVersionFromApi);
        const earliestVersionInManifest = manifestData[0].version;
    
        if (!semver.gte(earliestVersionFromApi, earliestVersionInManifest)) {
            core.info(`The earliest version of ${this.name} does not match the one in the manifest.\n`);
            core.warning(`The earliest version of ${this.name} is ${earliestVersionFromApi} and the one in the manifest is ${earliestVersionInManifest}.`);
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] ${this.name} version \`${earliestVersionFromApi}\` is not in the manifest`,
                body:  `Hello :wave:
                        The earliest version of ${this.name} is \`${earliestVersionFromApi}\` and the one in the manifest is \`${earliestVersionInManifest}\`. Please consider updating the manifest.`,
                labels: ['manifest-version-mismatch'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, earliestVersionFromApi);
            return;
        }
    
        core.info(`The earliest version of ${this.name} (${earliestVersionFromApi}) matches the one in the manifest. Checking the EOL support date...\n`);
    
        if (isDateMoreThanSixMonthsApart(new Date(filteredToolVersionsFromApi[0].eol))) {
            core.info(`The version ${earliestVersionFromApi} has more than 6 months left before EOL. It will reach its EOL date on ${filteredToolVersionsFromApi[0].eol} \n`);
            return;
        }
    
        else if (!isDateMoreThanSixMonthsApart(new Date(filteredToolVersionsFromApi[0].eol))) {
            const earliestVersionFromApiEol = filteredToolVersionsFromApi[0].eol;
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] ${this.name} version \`${earliestVersionFromApi}\` is losing support on ${earliestVersionFromApiEol}`,
                body:  `Hello :wave: 
                        The support for ${this.name} version \`${earliestVersionFromApi}\` is ending on ${earliestVersionFromApiEol}. Please consider upgrading to a newer version of ${this.name}.`,
                labels: ['deprecation-notice'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, earliestVersionFromApi);
            return;
        }
        
        else {
            core.setFailed(" The version " + earliestVersionFromApi + " is no longer supported. It has reached its EOL date on " + filteredToolVersionsFromApi[0].eol + ".");
        }

    }
}


export class NodeTool extends Tool {
    constructor(
        name: string = 'Node', 
        apiEndpoint: string = 'https://endoflife.date/api/node.json', 
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'node-versions')
        ) {
        super(name, apiEndpoint, manifestRepository);
    }
}



export class PythonTool extends Tool {
    constructor(
        name: string = 'Python',
        apiEndpoint: string = 'https://endoflife.date/api/python.json',
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'python-versions')
        ) {
        super(name, apiEndpoint, manifestRepository);
    }
}



export class GoTool extends Tool {
    constructor(
        name: string = 'Go',
        apiEndpoint: string = 'https://endoflife.date/api/go.json',
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'go-versions')
        ) {
        super(name, apiEndpoint, manifestRepository);
    }

    async checkVersions() {
        const goVersionsFromApi = await this.getVersionsFromApi(this.apiEndpoint);
        const firstTwoVersionsFromApi =  goVersionsFromApi.slice(0, 2);
        const reversedFirstTwoVersions = firstTwoVersionsFromApi.reverse();
        const earliestVersionFromApi = reversedFirstTwoVersions[0].latest;

        const goVersionsFromManifest = await this.manifestRepository.getVersionsManifestFromRepo(reversedFirstTwoVersions[0].latest);
        const latestFromManifest = goVersionsFromManifest[0].version;
    
        core.info(`\n ${this.name} version: ${earliestVersionFromApi}`);
        core.info(` For more info on ${this.name} versions, please visit: https://endoflife.date/go \n`);
        
        if (!semver.gte(reversedFirstTwoVersions[0].latest, latestFromManifest)) {
            core.info(`The latest version of Go does not match the one in the manifest.\n`);
            core.warning(`The latest version of Go is ${reversedFirstTwoVersions[0].latest} and the one in the manifest is ${latestFromManifest}.`);
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] Go version \`${reversedFirstTwoVersions[0].latest}\` is not in the manifest`,
                body:  `Hello :wave:
                        The latest version of Go is \`${reversedFirstTwoVersions[0].latest}\` and the one in the manifest is \`${latestFromManifest}\`. Please consider updating the manifest.`,
                labels: ['manifest-version-mismatch'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, reversedFirstTwoVersions[0].latest);
            return;
        }
    
        core.info(`The latest version of Go matches the one in the manifest. Checking the EOL support date...\n`);
    
        const sixMonthsFromEarliestVersion = calculateSixMonthsFromGivenDate(new Date(reversedFirstTwoVersions[0].latestReleaseDate));
    
        if (isDateMoreThanSixMonthsApart(new Date(sixMonthsFromEarliestVersion))) {
            core.info(`The version ${reversedFirstTwoVersions[0].latest} has more than 6 months left before EOL. It will reach its EOL date on ${reversedFirstTwoVersions[0].eol} \n`);
            return;
        }
    
        else if (!isDateMoreThanSixMonthsApart(new Date(sixMonthsFromEarliestVersion))) {
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] Go version \`${reversedFirstTwoVersions[0].latest}\` is losing support soon!`,
                body:  `Hello :wave: 
                        The support for Go version \`${reversedFirstTwoVersions[0].latest}\` is ending in less than 6 months. Please consider upgrading to a newer version of Go.`,
                labels: ['deprecation-notice'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, reversedFirstTwoVersions[0].latest);
            return;
        }

        else {
            core.setFailed(" The version " + reversedFirstTwoVersions[0].latest + " is no longer supported. It has reached its EOL date on " + reversedFirstTwoVersions[0].eol + ".");
        }
    }
}