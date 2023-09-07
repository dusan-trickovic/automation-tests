import * as semver from 'semver';
import * as core from '@actions/core';
import dayjs from 'dayjs';
import { dateGte, isDateMoreThanSixMonthsApart } from "./utils";
import { BaseRepository, GitHubIssue, ManifestRepository } from './repository-classes';

interface IResponseFormat {
    eol: string;
    latest: string;
    latestReleaseDate: string;
}

abstract class Tool {
    constructor(
        protected name: string, 
        protected apiEndpoint: string, 
        protected manifestRepository: ManifestRepository,
        protected internalRepository: BaseRepository = new BaseRepository('dusan-trickovic', 'automation-tests')
        ) {
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
            return dateGte(eolDate, new Date());
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
        const earliestVersionInManifest = manifestData[0].version;
    
        if (!semver.gte(earliestVersionFromApi, earliestVersionInManifest)) {
            core.info(`The version of ${this.name} (${earliestVersionFromApi}) provided by the API does not match the one in the manifest (${earliestVersionInManifest}).\n`);
            core.warning(`The version of ${this.name} provided by the API is ${earliestVersionFromApi} and the one in the manifest is ${earliestVersionInManifest}.`);
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
    
        core.info(`The version of ${this.name} provided by the API (${earliestVersionFromApi}) matches the one in the manifest (${earliestVersionInManifest}). Checking the EOL support date...\n`);
    
        if (isDateMoreThanSixMonthsApart(new Date(filteredToolVersionsFromApi[0].eol))) {
            core.info(`${this.name} version ${earliestVersionFromApi} has more than 6 months left before EOL. It will reach its EOL date on ${filteredToolVersionsFromApi[0].eol} \n`);
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
        const earliestVersionFromApi = reversedFirstTwoVersions[0];

        const goVersionsFromManifest = await this.manifestRepository.getVersionsManifestFromRepo(earliestVersionFromApi.latest);
        const firstTwoVersionsFromManifest = goVersionsFromManifest.slice(0, 2);
        const latestFromManifest = firstTwoVersionsFromManifest[0];
    
        core.info(`\n ${this.name} version: ${earliestVersionFromApi.latest}`);
        core.info(` For more info on ${this.name} versions, please visit: https://endoflife.date/go \n`);
        
        if (!semver.gte(earliestVersionFromApi.latest, latestFromManifest.version)) {
            core.info(`The version of Go (${earliestVersionFromApi.latest}) from API does not match the one in the manifest (${latestFromManifest.version}).\n`);
            core.warning(`The version of Go provided by the API is ${earliestVersionFromApi.latest} and the one in the manifest is ${latestFromManifest.version}.`);
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] Go version \`${earliestVersionFromApi.latest}\` is not in the manifest`,
                body:  `Hello :wave:
                        The latest version of Go is \`${earliestVersionFromApi.latest}\` and the one in the manifest is \`${latestFromManifest.version}\`. Please consider updating the manifest.`,
                labels: ['manifest-version-mismatch'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, earliestVersionFromApi.latest);
            return;
        }
    
        core.info(`The version of Go provided by the API (${earliestVersionFromApi.latest}) matches the one in the manifest (${latestFromManifest.version}). Checking the EOL support date...\n`);
    
        const sixMonthsFromEarliestVersion = dayjs(earliestVersionFromApi.latestReleaseDate).add(6, "months").format("YYYY-MM-DD");

        if (isDateMoreThanSixMonthsApart(new Date(sixMonthsFromEarliestVersion))) {
            core.info(`The version ${earliestVersionFromApi.latest} has more than 6 months left before EOL. It will reach its EOL date on ${earliestVersionFromApi.eol} \n`);
            return;
        }
    
        else if (!isDateMoreThanSixMonthsApart(new Date(sixMonthsFromEarliestVersion))) {
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] Go version \`${earliestVersionFromApi.latest}\` is losing support soon!`,
                body:  `Hello :wave: 
                        The support for Go version \`${earliestVersionFromApi.latest}\` is ending in less than 6 months. Please consider upgrading to a newer version of Go.`,
                labels: ['deprecation-notice'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssueAndSendToSlack(this.internalRepository, this.name, earliestVersionFromApi.latest);
            return;
        }

        else {
            core.setFailed(" The version " + earliestVersionFromApi.latest + " is no longer supported. It has reached its EOL date on " + earliestVersionFromApi.eol + ".");
        }
    }
}