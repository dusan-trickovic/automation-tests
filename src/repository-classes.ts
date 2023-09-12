import * as core from '@actions/core';
import * as semver from 'semver';
import { ACCESS_TOKEN } from './config';
import { Octokit } from '@octokit/rest';
import { SlackMessage } from './message';
import fetch from 'node-fetch';

interface IGithubFileContent {
    content: string;
}

interface INecessaryDataFromManifest {
    version: string;
}

const octokit = new Octokit({ 
    auth: `${ACCESS_TOKEN}`,
    request: {
        fetch: fetch,
    },
});

abstract class BaseRepository {
    constructor (public owner: string, public repo: string) {
        this.owner = owner;
        this.repo = repo;
    }

    protected async fetchAllOpenIssues(): Promise<GitHubIssue[]> {
        try {
            const response = await octokit.issues.listForRepo({
                owner: this.owner,
                repo: this.repo,
                state: 'open',
            });
            const data: unknown = response.data;
            return data as GitHubIssue[];
        } catch (error) {
            throw new Error((error as Error).message);
        }
    }

    async findIssueByTitle(title: string): Promise<GitHubIssue | null> {
        const allOpenIssues = await this.fetchAllOpenIssues();
        const issue = allOpenIssues.find((issue: GitHubIssue) => issue.title === title);
        return issue || null;
    }
}

export class InternalRepository extends BaseRepository {
    constructor (owner: string = 'dusan-trickovic', repo: string = 'automation-tests') {
        super(owner, repo);
    }
}

export class ManifestRepository extends BaseRepository {
    constructor (owner: string, repo: string, public path: string = 'versions-manifest.json') {
        super(owner, repo);
    }

    async getVersionsManifestFromRepo(referenceVersion: string): Promise<INecessaryDataFromManifest[]> {
        try {   
            const response = await octokit.repos.getContent({
                owner: this.owner,
                repo:  this.repo,
                path:  this.path,
            });
    
            const githubFileContent = response.data as IGithubFileContent;
            const content = Buffer.from(githubFileContent.content, 'base64').toString();
            const jsonData = JSON.parse(content);
            const reversedJsonData = jsonData.reverse();
            const latestFromManifest: INecessaryDataFromManifest[] = reversedJsonData.filter((item: INecessaryDataFromManifest) => {
                return semver.gte(item.version, referenceVersion);
            });
            return latestFromManifest as INecessaryDataFromManifest[];
        } catch (error) {
            throw new Error((error as Error).message);
        }
    }
}

export class GitHubIssue {
    constructor(public title: string, public body: string, public labels: string[]) {
        this.title = title;
        this.body = body;
        this.labels = labels;
    }

    async sendIssueInfoToSlack(
        toolName: string,
        expiringToolVersion: string
    ) {
        const slackMessageBuilder = new SlackMessage();
        try {
            slackMessageBuilder.buildMessage(this.body);
            await slackMessageBuilder.sendMessage();
            const successMessage = `Successfully sent a Slack message regarding the issue for ${toolName} version ${expiringToolVersion}. \n`;
            core.info(successMessage);
            return;
        } catch (error) {
            const errorMessage = (error as Error).message;
            core.setFailed("Error while sending the notification to Slack: " + errorMessage);
        }
    }

    async createIssue(
        repository: InternalRepository,
        toolName: string,
        expiringToolVersion: string
    ) {
        try {
            await octokit.issues.create({
                owner: repository.owner,
                repo: repository.repo,
                title: this.title,
                body: this.body,
                labels: this.labels,
            });
            const successMessage = `Successfully created an issue for ${toolName} version ${expiringToolVersion}.\n`;
            core.info(successMessage);
            return;
        } catch (error) {
            const errorMessage = (error as Error).message;
            core.setFailed("Error while creating an issue: " + errorMessage);
        }
    }
}