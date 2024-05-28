/* ==========================================================================================================
 * 
 *      Description:
 * 
 *          A simple utility to add properties to the coverity on polaris project settings.
 *          The properties objects are described as "key:value" pairs and may be found within
 *          each project under the advanced tab.  
 * 
 *          The script is run in two phases:
 * 
 * 
 *          PHASE ONE:
 * 
 *          The script will first pull a list of projects via the coverity on polaris api (the 
 *          current endpoint limits to the first 500 projects) and the information describing 
 *          each project is written to a file called "projectList.json".  Within the file are the
 *          project ID's as well as, property elements that may be reviewed and updated.  If the 
 *          project does not contain a key/value pair, one will be created that may be updated
 *          by the user.  To run the first phase to retrieve the project information
 * 
 *                  node ./getProjectUserInformation.mjs
 * 
 *          The script will create a second file (userList) which will provide all:
 * 
 *              - Users
 *              - Project Names
 *              - Email Addresses
 *              - Project ID's
 * 
 * 
 *      Usage:
 *          
 *          Review the CONFIG.JSON file and populate the email and password information for the user 
 *          running the script.
 * 
 *      Output:
 * 
 *          There are two output files provided:  CSV and JSON.  Both are titled "userList" with 
 *          the associated extension.
 * 
 *              - userList.csv
 *              - userList.json
 * 
 * 
 *      Date: 
 *          
 *          May 21, 2024 -- Initial build
 *                  -- David Nester (dnester@synopsys.com)
 *          
 *          May 28, 2024 -- David Nester
 *                  -- Addition of pulling group information for all users.   There are three files created
 *                     (grouplist.json, userlist.json, userlist.csv)
 * 
 * ==========================================================================================================
 */


import axios from 'axios';
import fs from 'fs/promises';
import readline from 'readline';
import { createObjectCsvWriter } from 'csv-writer';

const configPath = './config.json';
const projectListPath = './projectList.json';
const csvPath = './projectList.csv';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

const fetchProjectsWithAuth = async () => {
  try {
    // Check if projectList.json already exists
    let fileExists = false;
    try {
      await fs.access(projectListPath);
      fileExists = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    if (fileExists) {
      const answer = await askQuestion('projectList.json already exists. Do you want to delete it? [ yes | no ]: ');
      if (!['yes', 'y'].includes(answer.toLowerCase())) {
        console.log('Exiting script without making changes.');
        rl.close();
        return;
      }
      await fs.unlink(projectListPath);
      console.log('Existing projectList.json file deleted.');
    }

    // Check if projectList.csv already exists
    fileExists = false;
    try {
      await fs.access(csvPath);
      fileExists = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    if (fileExists) {
      const answer = await askQuestion('projectList.csv already exists. Do you want to delete it? [ yes | no ]: ');
      if (!['yes', 'y'].includes(answer.toLowerCase())) {
        console.log('Exiting script without making changes.');
        rl.close();
        return;
      }
      await fs.unlink(csvPath);
      console.log('Existing projectList.csv file deleted.');
    }

    // Read config from config.json
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Replace {customer} placeholder in URLs
    const authUrl = config.authUrlTemplate.replace('{customer}', config.customer);
    const authUrlV2 = config.authUrlV2Template.replace('{customer}', config.customer);
    const projectsUrl = config.projectsUrlTemplate.replace('{customer}', config.customer);
    const baseProjectsUrl = projectsUrl.split('?')[0];

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
    const limit = 5;
    let allProjects = [];
    let moreProjects = true;

    // Loop to fetch all projects with pagination
    while (moreProjects) {
      const projectsUrlWithPagination = `${baseProjectsUrl}?page[limit]=${limit}&page[offset]=${offset}`;

      // Config for fetching projects
      const projectsConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: projectsUrlWithPagination,
        headers: { 
          'accept': 'application/vnd.api+json',
          'Authorization': `Bearer ${token}`
        }
      };

      console.log(`Fetching projects with offset=${offset}...`);
      // Request to fetch projects
      const projectsResponse = await axios.request(projectsConfig);
      console.log('Projects response received:', projectsResponse.status, projectsResponse.statusText);

      if (projectsResponse.status === 200) {
        const projectsData = projectsResponse.data.data;
        const formattedProjects = projectsData.map(project => ({
          id: project.id,
          name: project.attributes.name
        }));

        allProjects = [...allProjects, ...formattedProjects];

        // Check if there are more projects to fetch
        moreProjects = projectsData.length === limit;
        offset += limit;
      } else {
        console.error(`HTTP Error: ${projectsResponse.status} - ${projectsResponse.statusText}`);
        moreProjects = false;
      }
    }

    const jsonContent = JSON.stringify(allProjects, null, 2);

    // Write JSON content to file
    await fs.writeFile(projectListPath, jsonContent, 'utf8');
    console.log('Project list has been saved to projectList.json');

    // Extract user details from each project
    let allUsers = [];
    let allGroups = [];

    for (const project of allProjects) {
      const roleAssignmentsUrl = `https://demo.polaris.synopsys.com/api/auth/v2/role-assignments?filter%5Brole-assignments%5D%5Bobject%5D%5B%24eq%5D=urn%3Ax-swip%3Aprojects%3A${project.id}&include%5Brole-assignments%5D%5B%5D=role&include%5Brole-assignments%5D%5B%5D=user&include%5Brole-assignments%5D%5B%5D=group`;

      const roleAssignmentsConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: roleAssignmentsUrl,
        headers: { 
          'accept': 'application/vnd.api+json',
          'Authorization': `Bearer ${token}`
        }
      };

      console.log(`Fetching role assignments for project ${project.name} (ID: ${project.id})...`);
      const roleAssignmentsResponse = await axios.request(roleAssignmentsConfig);
      console.log('Role assignments response received:', roleAssignmentsResponse.status, roleAssignmentsResponse.statusText);

      if (roleAssignmentsResponse.status === 200) {
        const groups = roleAssignmentsResponse.data.included.filter(item => item.type === 'groups');
        const users = roleAssignmentsResponse.data.included.filter(item => item.type === 'users').map(user => ({
          projectName: project.name,
          projectId: project.id,
          name: user.attributes.name,
          email: user.attributes.email,
          group: groups.find(group => group.id === user.relationships.groups.data[0]?.id)?.attributes.groupname || 'N/A'
        }));

        allUsers = [...allUsers, ...users];
        allGroups = [...allGroups, ...groups];
      } else {
        console.error(`HTTP Error: ${roleAssignmentsResponse.status} - ${roleAssignmentsResponse.statusText}`);
      }
    }

    const usersJsonContent = JSON.stringify(allUsers, null, 2);

    // Write JSON content to file
    await fs.writeFile('./usersList.json', usersJsonContent, 'utf8');
    console.log('User list has been saved to usersList.json');

    // Write CSV content to file
    const csvWriter = createObjectCsvWriter({
      path: './usersList.csv',
      header: [
        { id: 'projectName', title: 'Project Name' },
        { id: 'projectId', title: 'Project ID' },
        { id: 'name', title: 'Name' },
        { id: 'email', title: 'Email' },
        { id: 'group', title: 'Group' }
      ]
    });

    await csvWriter.writeRecords(allUsers);
    console.log('User list has been saved to usersList.csv');

    // Extract unique groups and write to a separate file
    const uniqueGroups = Array.from(new Set(allGroups.map(group => group.attributes.groupname)));
    const groupsJsonContent = JSON.stringify(uniqueGroups, null, 2);
    await fs.writeFile('./groupsList.json', groupsJsonContent, 'utf8');
    console.log('Group list has been saved to groupsList.json');

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

fetchProjectsWithAuth();



/*
 *      eof.
 */

