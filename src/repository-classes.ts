import * as core from '@actions/core';
import * as semver from 'semver';
import { ACCESS_TOKEN } from './config';
import { Octokit } from '@octokit/rest';
import { SlackMessage } from './message';

interface GithubFileContent {
    content: string;
}

const octokit = new Octokit({ 
    auth: `${ACCESS_TOKEN}`,
    request: {
        fetch: fetch,
    },
});

export class BaseRepository {
    constructor (public owner: string, public repo: string) {
        this.owner = owner;
        this.repo = repo;
    }
}

export class ManifestRepository extends BaseRepository {
    constructor (owner: string, repo: string, public path: string = 'versions-manifest.json') {
        super(owner, repo);
    }

    async getVersionsManifestFromRepo(referenceVersion: string) {
        try {   
            const response = await octokit.repos.getContent({
            owner: this.owner,
            repo:  this.repo,
            path:  this.path,
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
}

export class GitHubIssue {
    constructor(public title: string, public body: string, public labels: string[]) {
        this.title = title;
        this.body = body;
        this.labels = labels;
    }

    async createIssueAndSendToSlack(
        baseRepository: BaseRepository,
        toolName: string,
        expiringToolVersion: string
        ) {
        const slackMessageBuilder = new SlackMessage();
        try {
            await octokit.issues.create({
                owner: baseRepository.owner,
                repo: baseRepository.repo,
                title: this.title,
                body: this.body,
                labels: this.labels,
            });
        slackMessageBuilder.buildMessage(this.body);
        await slackMessageBuilder.sendMessage();
        const successMessage = `Successfully created an issue for ${toolName} version ${expiringToolVersion}.\n`;
        core.info(successMessage);
        return;
        } catch (error) {
            const errorMessage = (error as Error).message;
            core.setFailed("Error while creating an issue: " + errorMessage);
        }
    }
}