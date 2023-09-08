import * as semver from 'semver';
import * as core from '@actions/core';
import dayjs from 'dayjs';
import fetch from 'node-fetch';
import { dateGte, isDateMoreThanSixMonthsAway } from "./utils";
import { GitHubIssue, InternalRepository, ManifestRepository } from './repository-classes';

interface IResponseFormat {
    eol: string;
    latest: string;
    latestReleaseDate: string;
    lts: boolean | string;
}

abstract class Tool {
    constructor(
        protected name: string, 
        protected eolApiEndpoint: string, 
        protected manifestRepository: ManifestRepository,
        protected internalRepository: InternalRepository = new InternalRepository()
    ) {
        this.name = name;
        this.eolApiEndpoint = eolApiEndpoint;
        this.manifestRepository = manifestRepository;
    }

    protected async getVersionsFromApi(url: string): Promise<IResponseFormat[]> {
        const response = await fetch(url);
        const data: IResponseFormat[] = await response.json() as IResponseFormat[];
        return data;
    }

    protected async filterApiData(data: IResponseFormat[]) {
        const filteredData = data.filter((item: IResponseFormat) => {
            const eolDate = new Date(item.eol);
            // The condition below is needed as 'lts: false' for Node means that the version is unstable (e.g. v15)
            // while in the response for Python and Go, all versions have 'lts' set to false and it would return undefined.
            const condition = this.name === 'Node' ? 
                (dateGte(eolDate, new Date()) && item.lts !== false) : 
                dateGte(eolDate, new Date());
            return condition;
        }).reverse();
        return filteredData;
    }

    async checkVersions() {
        const toolVersionsFromEolApi = await this.getVersionsFromApi(this.eolApiEndpoint);
        const filteredToolVersionsFromEolApi = await this.filterApiData(toolVersionsFromEolApi);
        const versionClosestToEol = filteredToolVersionsFromEolApi[0];
        
        core.info(`\n ${this.name} version: ${versionClosestToEol.latest}`);
        core.info(` For more info on ${this.name} versions, please visit: https://endoflife.date/${this.name === 'Node' ? 'nodejs' : 'python' }\n`);
        
        const manifestData = await this.manifestRepository.getVersionsManifestFromRepo(versionClosestToEol.latest);
        const earliestVersionInManifest = manifestData[0].version;
    
        if (!semver.gte(versionClosestToEol.latest, earliestVersionInManifest)) {
            core.info(`The version of ${this.name} (${versionClosestToEol.latest}) provided by the API does not match the one in the manifest (${earliestVersionInManifest}).\n`);
            core.warning(`The version of ${this.name} provided by the API is ${versionClosestToEol.latest} and the one in the manifest is ${earliestVersionInManifest}.`);
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] ${this.name} version \`${versionClosestToEol.latest}\` is not in the manifest`,
                body:  `Hello :wave:
                        The earliest version of ${this.name} is \`${versionClosestToEol.latest}\` and the one in the manifest is \`${earliestVersionInManifest}\`. Please consider updating the manifest.`,
                labels: ['manifest-version-mismatch'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssue(this.internalRepository, this.name, versionClosestToEol.latest);
            await githubIssue.sendIssueToSlack(this.name, versionClosestToEol.latest);
            return;
        }
    
        core.info(`The version of ${this.name} provided by the API (${versionClosestToEol.latest}) matches the one in the manifest (${earliestVersionInManifest}). Checking the EOL support date...\n`);
    
        if (isDateMoreThanSixMonthsAway(new Date(versionClosestToEol.eol))) {
            core.info(`${this.name} version ${versionClosestToEol.latest} has more than 6 months left before EOL. It will reach its EOL date on ${versionClosestToEol.eol} \n`);
            return;
        }
        
        const issueContent = {
            title: `[AUTOMATIC MESSAGE] ${this.name} version \`${versionClosestToEol.latest}\` is losing support on ${versionClosestToEol.eol}`,
            body:  `Hello :wave: 
                    The support for ${this.name} version \`${versionClosestToEol.latest}\` is ending on ${versionClosestToEol.eol}. Please consider upgrading to a newer version of ${this.name}.`,
            labels: ['deprecation-notice'],
        };

        const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
        await githubIssue.createIssue(this.internalRepository, this.name, versionClosestToEol.latest);
        await githubIssue.sendIssueToSlack(this.name, versionClosestToEol.latest);
        return;
        
    }
}


export class NodeTool extends Tool {
    constructor(
        name: string = 'Node', 
        eolApiEndpoint: string = 'https://endoflife.date/api/node.json', 
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'node-versions')
        ) {
        super(name, eolApiEndpoint, manifestRepository);
    }
}


export class PythonTool extends Tool {
    constructor(
        name: string = 'Python',
        eolApiEndpoint: string = 'https://endoflife.date/api/python.json',
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'python-versions')
        ) {
        super(name, eolApiEndpoint, manifestRepository);
    }
}


export class GoTool extends Tool {
    constructor(
        name: string = 'Go',
        eolApiEndpoint: string = 'https://endoflife.date/api/go.json',
        manifestRepository: ManifestRepository = new ManifestRepository('actions', 'go-versions')
        ) {
        super(name, eolApiEndpoint, manifestRepository);
    }

    async checkVersions() {
        const goVersionsFromEolApi = await this.getVersionsFromApi(this.eolApiEndpoint);
        const firstTwoVersionsFromEolApi =  goVersionsFromEolApi.slice(0, 2);
        const reversedFirstTwoVersions = firstTwoVersionsFromEolApi.reverse();
        const versionClosestToEol = reversedFirstTwoVersions[0];

        const goVersionsFromManifest = await this.manifestRepository.getVersionsManifestFromRepo(versionClosestToEol.latest);
        const firstTwoVersionsFromManifest = goVersionsFromManifest.slice(0, 2);
        const latestFromManifest = firstTwoVersionsFromManifest[0];
    
        core.info(`\n ${this.name} version: ${versionClosestToEol.latest}`);
        core.info(` For more info on ${this.name} versions, please visit: https://endoflife.date/go \n`);
        
        if (!semver.gte(versionClosestToEol.latest, latestFromManifest.version)) {
            core.info(`The version of Go (${versionClosestToEol.latest}) from API does not match the one in the manifest (${latestFromManifest.version}).\n`);
            core.warning(`The version of Go provided by the API is ${versionClosestToEol.latest} and the one in the manifest is ${latestFromManifest.version}.`);
            const issueContent = {
                title: `[AUTOMATIC MESSAGE] Go version \`${versionClosestToEol.latest}\` is not in the manifest`,
                body:  `Hello :wave:
                        The latest version of Go is \`${versionClosestToEol.latest}\` and the one in the manifest is \`${latestFromManifest.version}\`. Please consider updating the manifest.`,
                labels: ['manifest-version-mismatch'],
            };
    
            const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
            await githubIssue.createIssue(this.internalRepository, this.name, versionClosestToEol.latest);
            await githubIssue.sendIssueToSlack(this.name, versionClosestToEol.latest);
            return;
        }
    
        core.info(`The version of Go provided by the API (${versionClosestToEol.latest}) matches the one in the manifest (${latestFromManifest.version}). Checking the EOL support date...\n`);
    
        const sixMonthsFromEarliestVersion = dayjs(versionClosestToEol.latestReleaseDate).add(6, "months").format("YYYY-MM-DD");

        if (isDateMoreThanSixMonthsAway(new Date(sixMonthsFromEarliestVersion))) {
            core.info(`The version ${versionClosestToEol.latest} has more than 6 months left before EOL. It will reach its EOL date on ${versionClosestToEol.eol} \n`);
            return;
        }
    
        const issueContent = {
            title: `[AUTOMATIC MESSAGE] Go version \`${versionClosestToEol.latest}\` is losing support soon!`,
            body:  `Hello :wave: 
                    The support for Go version \`${versionClosestToEol.latest}\` is ending in less than 6 months. Please consider upgrading to a newer version of Go.`,
            labels: ['deprecation-notice'],
        };

        const githubIssue = new GitHubIssue(issueContent.title, issueContent.body, issueContent.labels);
        await githubIssue.createIssue(this.internalRepository, this.name, versionClosestToEol.latest);
        await githubIssue.sendIssueToSlack(this.name, versionClosestToEol.latest);
        return;

    }
        
}