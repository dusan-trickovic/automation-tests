import * as semver from 'semver';
import * as core from '@actions/core';
import fetch from 'node-fetch';
import {dateGte, isDateMoreThanSixMonthsAway} from './utils';
import {
  GitHubIssue,
  InternalRepository,
  ManifestRepository
} from './repository-classes';

interface IApiResponseFormat {
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

  protected async getVersionsFromApi(
    url: string
  ): Promise<IApiResponseFormat[]> {
    const response = await fetch(url);
    const data: IApiResponseFormat[] =
      (await response.json()) as IApiResponseFormat[];
    return data;
  }

  protected async filterApiData(data: IApiResponseFormat[]) {
    const filteredData = data
      .filter((item: IApiResponseFormat) => {
        const eolDate = new Date(item.eol);
        // The condition below is needed as 'lts: false' for Node means that the version is unstable (e.g. v15)
        // while in the response for Python and Go, all versions have 'lts' set to false and it would return undefined.
        const condition =
          this.name === 'Node'
            ? dateGte(eolDate, new Date()) && item.lts !== false
            : dateGte(eolDate, new Date());
        return condition;
      })
      .reverse();
    return filteredData;
  }

  async checkVersions() {
    const toolVersionsFromEolApi = await this.getVersionsFromApi(
      this.eolApiEndpoint
    );
    const filteredToolVersionsFromEolApi = await this.filterApiData(
      toolVersionsFromEolApi
    );
    const versionClosestToEol = filteredToolVersionsFromEolApi[0];

    core.info(`\n ${this.name} version: ${versionClosestToEol.latest}`);
    core.info(
      ` For more info on ${
        this.name
      } versions, please visit: https://endoflife.date/${
        this.name === 'Node' ? 'nodejs' : 'python'
      }\n`
    );

    const manifestData =
      await this.manifestRepository.getVersionsManifestFromRepo(
        versionClosestToEol.latest
      );
    const earliestVersionInManifest = manifestData[0].version;

    if (!semver.gte(versionClosestToEol.latest, earliestVersionInManifest)) {
      core.warning(
        `The version of ${this.name} (${versionClosestToEol.latest}) provided by the API does not match the one in the manifest (${earliestVersionInManifest}).\n`
      );
      const issueContent = {
        title: `[AUTOMATIC MESSAGE] ${this.name} version \`${versionClosestToEol.latest}\` is not in the manifest`,
        body: `Hello :wave:
                        The earliest version of ${this.name} is \`${versionClosestToEol.latest}\` and the one in the manifest is \`${earliestVersionInManifest}\`. Please consider updating the manifest.`,
        labels: ['manifest-version-mismatch']
      };

      if (await this.internalRepository.findIssueByTitle(issueContent.title)) {
        core.info(
          `\n The issue with the title '${issueContent.title}' already exists. Please check the internal repository (${this.internalRepository.owner}/${this.internalRepository.repo}). Skipping the creation of a new issue.\n`
        );
        return;
      }

      core.info(
        'Creating an issue in the internal repository and sending a notification to Slack...\n'
      );

      const githubIssue = new GitHubIssue(
        issueContent.title,
        issueContent.body,
        issueContent.labels
      );
      await githubIssue.createIssue(
        this.internalRepository,
        this.name,
        versionClosestToEol.latest
      );
      await githubIssue.sendIssueInfoToSlack(
        this.name,
        versionClosestToEol.latest
      );
      return;
    }

    core.info(
      `The version of ${this.name} provided by the API (${versionClosestToEol.latest}) matches the one in the manifest (${earliestVersionInManifest}). Checking the EOL support date...\n`
    );

    if (isDateMoreThanSixMonthsAway(new Date(versionClosestToEol.eol))) {
      core.info(
        `${this.name} version ${versionClosestToEol.latest} has more than 6 months left before EOL. It will reach its EOL date on ${versionClosestToEol.eol} \n`
      );
      return;
    }

    core.info(
      `The version of ${this.name} is losing support in less than 6 months (${versionClosestToEol.eol}).\n`
    );

    const issueContent = {
      title: `[AUTOMATIC MESSAGE] ${this.name} version \`${versionClosestToEol.latest}\` is losing support on ${versionClosestToEol.eol}`,
      body: `Hello :wave: 
                    The support for ${this.name} version \`${versionClosestToEol.latest}\` is ending on ${versionClosestToEol.eol}. Please consider upgrading to a newer version of ${this.name}.`,
      labels: ['deprecation-notice']
    };

    if (await this.internalRepository.findIssueByTitle(issueContent.title)) {
      core.info(
        `\n The issue with the title '${issueContent.title}' already exists. Please check the internal repository (${this.internalRepository.owner}/${this.internalRepository.repo}). Skipping the creation of a new issue.\n`
      );
      return;
    }

    core.info(
      'Creating an issue in the internal repository and sending a notification to Slack...\n'
    );

    const githubIssue = new GitHubIssue(
      issueContent.title,
      issueContent.body,
      issueContent.labels
    );
    await githubIssue.createIssue(
      this.internalRepository,
      this.name,
      versionClosestToEol.latest
    );
    await githubIssue.sendIssueInfoToSlack(
      this.name,
      versionClosestToEol.latest
    );
    return;
  }
}

export class NodeTool extends Tool {
  constructor(
    name = 'Node',
    eolApiEndpoint = 'https://endoflife.date/api/node.json',
    manifestRepository: ManifestRepository = new ManifestRepository(
      'actions',
      'node-versions'
    )
  ) {
    super(name, eolApiEndpoint, manifestRepository);
  }
}

export class PythonTool extends Tool {
  constructor(
    name = 'Python',
    eolApiEndpoint = 'https://endoflife.date/api/python.json',
    manifestRepository: ManifestRepository = new ManifestRepository(
      'actions',
      'python-versions'
    )
  ) {
    super(name, eolApiEndpoint, manifestRepository);
  }
}

export class GoTool extends Tool {
  constructor(
    name = 'Go',
    eolApiEndpoint = 'https://endoflife.date/api/go.json',
    manifestRepository: ManifestRepository = new ManifestRepository(
      'actions',
      'go-versions'
    )
  ) {
    super(name, eolApiEndpoint, manifestRepository);
  }

  async checkVersions() {
    const goVersionsFromEolApi = await this.getVersionsFromApi(
      this.eolApiEndpoint
    );
    // Each major Go release is supported until there are two newer major releases
    // The security policy can be found at https://go.dev/doc/devel/release#policy
    const versionClosestToEol = goVersionsFromEolApi[1];

    const goVersionsFromManifest =
      await this.manifestRepository.getVersionsManifestFromRepo(
        versionClosestToEol.latest
      );
    const latestFromManifest = goVersionsFromManifest[0];

    core.info(`\n ${this.name} version: ${versionClosestToEol.latest}`);
    core.info(
      ` For more info on ${this.name} versions, please visit: https://endoflife.date/go \n`
    );

    if (!semver.gte(versionClosestToEol.latest, latestFromManifest.version)) {
      core.warning(
        `The version of Go (${versionClosestToEol.latest}) from API does not match the one in the manifest (${latestFromManifest.version}).\n`
      );
      const issueContent = {
        title: `[AUTOMATIC MESSAGE] Go version \`${versionClosestToEol.latest}\` is not in the manifest`,
        body: `Hello :wave:
                The latest version of Go is \`${versionClosestToEol.latest}\` and the one in the manifest is \`${latestFromManifest.version}\`. Please consider updating the manifest.`,
        labels: ['manifest-version-mismatch']
      };

      if (await this.internalRepository.findIssueByTitle(issueContent.title)) {
        core.info(
          `\n The issue with the title '${issueContent.title}' already exists. Please check the internal repository (${this.internalRepository.owner}/${this.internalRepository.repo}). Skipping the creation of a new issue.\n`
        );
        return;
      }

      core.info(
        'Creating an issue in the internal repository and sending a notification to Slack...\n'
      );

      const githubIssue = new GitHubIssue(
        issueContent.title,
        issueContent.body,
        issueContent.labels
      );
      await githubIssue.createIssue(
        this.internalRepository,
        this.name,
        versionClosestToEol.latest
      );
      await githubIssue.sendIssueInfoToSlack(
        this.name,
        versionClosestToEol.latest
      );
      return;
    }

    core.info(
      `The version of Go provided by the API (${versionClosestToEol.latest}) matches the one in the manifest (${latestFromManifest.version}).\n`
    );

    core.warning(
      `The earlier version of Go (${versionClosestToEol.latest}) is losing support in less than 6 months.\n`
    );

    const issueContent = {
      title: `[AUTOMATIC MESSAGE] Go version \`${versionClosestToEol.latest}\` is losing support soon!`,
      body: `Hello :wave: 
            The support for Go version \`${versionClosestToEol.latest}\` is ending in less than 6 months. Please consider upgrading to a newer version of Go.`,
      labels: ['deprecation-notice']
    };

    if (await this.internalRepository.findIssueByTitle(issueContent.title)) {
      core.info(
        `\n The issue with the title '${issueContent.title}' already exists. Please check the internal repository (${this.internalRepository.owner}/${this.internalRepository.repo}). Skipping the creation of a new issue.\n`
      );
      return;
    }

    core.info(
      'Creating an issue in the internal repository and sending a notification to Slack...\n'
    );

    const githubIssue = new GitHubIssue(
      issueContent.title,
      issueContent.body,
      issueContent.labels
    );
    await githubIssue.createIssue(
      this.internalRepository,
      this.name,
      versionClosestToEol.latest
    );
    await githubIssue.sendIssueInfoToSlack(
      this.name,
      versionClosestToEol.latest
    );
    return;
  }
}
