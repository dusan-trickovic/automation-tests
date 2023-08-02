import * as fs from "fs";
import * as core from "@actions/core";
import * as semver from "semver";
import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";

// ALTERNATIVE SUGGESTION: You can only check for the versions that stop receiving support in the current year (and possibly the previous year).
// Check if the date is approaching and if it's about 6 months, generate an issue. If not, either do nothing or perform an action yet to be determined.

dotenv.config();

async function fetchJsonData(x: string) {
    const response = await fetch(x);
    const data = await response.json();
    const currentYear = new Date().getFullYear();

    const filteredData = data.filter((item: any) => {
        const eolDate = new Date(item.eol);
        return eolDate.getFullYear() >= currentYear || eolDate.getFullYear() === currentYear - 1;
    }).reverse();
    return filteredData;
}

async function fetchLocalJsonData(x: string) {
    let data = '';
    for(const line of fs.readFileSync(x, 'utf-8').split('\n')) {
        data += line;
    }
    let finalData = JSON.parse(data);
    return finalData;
}


async function main() {
    const octokit = new Octokit({ 
        auth: `${process.env.PERSONAL_ACCESS_TOKEN}`,
    });
    const testVersion = await fetchJsonData("https://endoflife.date/api/python.json");
    const currentDate = new Date().toISOString().split('T')[0];
    const availableManifest = await fetchLocalJsonData("versions-manifest.json");
    const reversedManifest = availableManifest.reverse();

    const getOnlyLatestFromManifest = reversedManifest.filter((item: any) => {
        return semver.gte(item.version, testVersion[0].latest);
    });

    const earliestVersionInManifest = getOnlyLatestFromManifest[0].version;
    const earliestVersionInManifestMajorMinor = semver.major(earliestVersionInManifest) + "." + semver.minor(earliestVersionInManifest);

    if (testVersion[0].cycle === earliestVersionInManifestMajorMinor) {
        console.log("Versions match");
    }

    const compareDates = currentDate <= testVersion[0].eol;

    if (compareDates === false) {
        const unsupportedMessage = "This version is no longer supported. Date when the support ended: " + testVersion[0].eol;
        core.info(unsupportedMessage);
        core.info("Creating an issue...");

        try {

            const createIssue = await octokit.issues.create({
                owner: "dusan-trickovic",
                repo: "automation-tests",
                title: "[AUTOMATIC MESSAGE] Python version " + testVersion[0].latest + " is no longer supported",
                body: "The support for Python version " + testVersion[0].latest + " has ended on " + testVersion[0].eol + ". Please consider upgrading to a newer version of Python."
            });
            return createIssue;

        } catch (error) {
            const errorMessage = (error as Error).message;
            console.log("Error while creating an issue: " + errorMessage);
            core.setFailed("Error while creating an issue: " + errorMessage);
        }
    }
    
    core.info("Python version " + testVersion[0].latest + " is still supported. Date when the support ends: " + testVersion[0].eol);
}

main();
