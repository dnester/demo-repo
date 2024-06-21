

import axios from 'axios';
import fs from 'fs/promises';
import readline from 'readline';
import { parseAsync } from 'json2csv';

const configPath = './config.json';
const projectListPath = './projectList.json';
const branchesListPath = './branchesList.json';
const outputCsvPath = './projectBranches.csv';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

const fetchBranchesWithAuth = async () => {
  try {
    // Check if branchesList.json already exists
    let fileExists = false;
    try {
      await fs.access(branchesListPath);
      fileExists = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    if (fileExists) {
      const answer = await askQuestion('branchesList.json already exists. Do you want to delete it? [ yes | no ]: ');
      if (!['yes', 'y'].includes(answer.toLowerCase())) {
        console.log('Exiting script without making changes.');
        rl.close();
        return;
      }
      await fs.unlink(branchesListPath);
      console.log('Existing branchesList.json file deleted.');
    }

    // Read config from config.json
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Replace {customer} placeholder in URLs
    const authUrl = config.authUrlTemplate?.replace('{customer}', config.customer);
    const authUrlV2 = config.authUrlV2Template?.replace('{customer}', config.customer);
    const branchesUrlTemplate = config.branchesUrlTemplate?.replace('{customer}', config.customer);

    if (!authUrl || !authUrlV2 || !branchesUrlTemplate) {
      throw new Error('One or more URL templates are missing or not correctly defined in the config.');
    }

    let authConfig;

    // Check if password or API key (access token) is provided and configure the auth request
    if (config.password && config.password.trim() !== "") {
      const authData = new URLSearchParams();
      authData.append('email', config.email);
      authData.append('password', config.password);

      authConfig = {
        method: 'post',
        url: authUrl,
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: authData
      };
    } else if (config.accesstoken && config.accesstoken.trim() !== "") {
      const authData = new URLSearchParams();
      authData.append('email', config.email);
      authData.append('accesstoken', config.accesstoken);

      authConfig = {
        method: 'post',
        url: authUrlV2,
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: authData
      };

      console.log('Using access token for authentication:');
      console.log('Request URL:', authConfig.url);
      console.log('Request Headers:', authConfig.headers);
      console.log('Request Data:', authData.toString());
    } else {
      throw new Error('Neither password nor access token is provided in the config.');
    }

    console.log('Sending authentication request...');
    // Request to retrieve JWT token
    const authResponse = await axios.request(authConfig);
    console.log('Authentication response received:', authResponse.status, authResponse.statusText);

    let token;

    // Extract the token from the set-cookie header or response body
    const setCookieHeader = authResponse.headers['set-cookie'];
    if (setCookieHeader) {
      const tokenCookie = setCookieHeader.find(cookie => cookie.startsWith('access_token='));
      if (tokenCookie) {
        token = tokenCookie.split(';')[0].split('=')[1];
      }
    }

    if (!token && authResponse.data && authResponse.data.jwt) {
      token = authResponse.data.jwt;
    }

    if (!token) {
      throw new Error('No access token found in the response.');
    }

    // Initialize variables for pagination
    let offset = 0;
    let allBranches = [];
    let moreBranches = true;

    // Loop to fetch all branches with pagination
    while (moreBranches) {
      const branchesUrl = branchesUrlTemplate.replace('{offset}', offset);

      console.log(`Fetching branches with URL: ${branchesUrl}`);
      const branchesConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: branchesUrl,
        headers: { 
          'accept': 'application/vnd.api+json',
          'Authorization': `Bearer ${token}`
        }
      };

      try {
        const branchesResponse = await axios.request(branchesConfig);
        if (branchesResponse.status === 200) {
          const branchesData = branchesResponse.data.data;

          allBranches = [...allBranches, ...branchesData];

          // Check if there are more branches to fetch
          moreBranches = branchesData.length === 500;
          offset += 500;
        } else {
          console.error(`HTTP Error: ${branchesResponse.status} - ${branchesResponse.statusText}`);
          console.error('Response data:', branchesResponse.data);
          moreBranches = false;
        }
      } catch (branchError) {
        console.error(`Error fetching branches:`, JSON.stringify(branchError.response ? branchError.response.data : branchError.message, null, 2));
        moreBranches = false;
      }
    }

    const jsonContent = JSON.stringify({ data: allBranches }, null, 2);

    // Write JSON content to file
    await fs.writeFile(branchesListPath, jsonContent, 'utf8');
    console.log('Branches list has been saved to branchesList.json');

    // Call the function to associate projects to branches
    await associateProjectsToBranches();

  } catch (error) {
    if (error.response) {
      // Handle errors from the server
      console.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('Response data:', error.response.data);
    } else {
      // Handle other errors
      console.error('Error:', error.message);
    }
  } finally {
    rl.close();
  }
};

const associateProjectsToBranches = async () => {
  try {
    // Read project list
    const projectListData = await fs.readFile(projectListPath, 'utf8');
    const projectList = JSON.parse(projectListData);

    // Read branches list
    const branchesListData = await fs.readFile(branchesListPath, 'utf8');
    const branchesList = JSON.parse(branchesListData);

    // Create a map of project IDs to project names and associated branches
    const projectMap = projectList.reduce((map, project) => {
      map[project.id] = { name: project.name, branches: [] };
      return map;
    }, {});

    // Associate branches to their respective projects
    branchesList.data.forEach(branch => {
      const projectId = branch.relationships.project.data.id;
      if (projectMap[projectId]) {
        projectMap[projectId].branches.push(branch.attributes.name);
      }
    });

    // Prepare data for CSV
    const csvData = Object.values(projectMap).map(project => {
      return {
        projectName: project.name,
        ...project.branches.reduce((obj, branchName, index) => {
          obj[`branchName${index + 1}`] = branchName;
          return obj;
        }, {})
      };
    });

    // Convert the data to CSV format
    const csvOutput = await parseAsync(csvData, {
      fields: ['projectName', ...Array.from({ length: Math.max(...csvData.map(project => Object.keys(project).length - 1)) }, (_, i) => `branchName${i + 1}`)],
      header: true
    });

    // Write the CSV content to file
    await fs.writeFile(outputCsvPath, csvOutput, 'utf8');
    console.log('Project branches have been saved to projectBranches.csv');

  } catch (error) {
    console.error('Error:', error.message);
  }
};

fetchBranchesWithAuth();
