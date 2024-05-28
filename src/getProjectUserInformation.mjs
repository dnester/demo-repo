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
 * 
 * 
 * ==========================================================================================================
 */


import axios from 'axios';
import fs from 'fs/promises';
import readline from 'readline';
import { createObjectCsvWriter } from 'csv-writer';

const configPath = './config.json';
const projectListPath = './projectList.json';
const csvPath = './projectDetails.csv';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

const fileExists = async (path) => {
  try {
    await fs.access(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

const deleteFileIfExists = async (path, message) => {
  if (await fileExists(path)) {
    const answer = await askQuestion(`${message} Do you want to delete it? [ yes | no ]: `);
    if (!['yes', 'y'].includes(answer.toLowerCase())) {
      console.log('Exiting script without making changes.');
      rl.close();
      return false;
    }
    await fs.unlink(path);
    console.log(`Existing ${path} file deleted.`);
  }
  return true;
};

const fetchProjectsWithAuth = async () => {
  try {
    if (!(await deleteFileIfExists(projectListPath, 'projectList.json already exists.')) ||
        !(await deleteFileIfExists(csvPath, 'projectDetails.csv already exists.'))) {
      return;
    }

    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);

    const authUrl = config.authUrlTemplate.replace('{customer}', config.customer);
    const authUrlV2 = config.authUrlV2Template.replace('{customer}', config.customer);
    const projectsUrl = config.projectsUrlTemplate.replace('{customer}', config.customer);
    const baseProjectsUrl = projectsUrl.split('?')[0];
    const usersUrl = 'https://demo.polaris.synopsys.com/api/auth/v2/users';

    let authConfig;

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
    const authResponse = await axios.request(authConfig);
    console.log('Authentication response received:', authResponse.status, authResponse.statusText);

    let token;

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

    let offset = 0;
    const limit = 5;
    let allProjects = [];
    let moreProjects = true;

    while (moreProjects) {
      const projectsUrlWithPagination = `${baseProjectsUrl}?page[limit]=${limit}&page[offset]=${offset}`;

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
      const projectsResponse = await axios.request(projectsConfig);
      console.log('Projects response received:', projectsResponse.status, projectsResponse.statusText);

      if (projectsResponse.status === 200) {
        const projectsData = projectsResponse.data.data;
        const formattedProjects = projectsData.map(project => ({
          id: project.id,
          name: project.attributes.name
        }));

        allProjects = [...allProjects, ...formattedProjects];

        moreProjects = projectsData.length === limit;
        offset += limit;
      } else {
        console.error(`HTTP Error: ${projectsResponse.status} - ${projectsResponse.statusText}`);
        moreProjects = false;
      }
    }

    const jsonContent = JSON.stringify(allProjects, null, 2);
    await fs.writeFile(projectListPath, jsonContent, 'utf8');
    console.log('Project list has been saved to projectList.json');

    // Fetching all users and their groups
    offset = 0;
    const userLimit = 50;
    let allUsers = [];
    let allGroups = {};

    let moreUsers = true;

    while (moreUsers) {
      const usersUrlWithPagination = `${usersUrl}?page[limit]=${userLimit}&page[offset]=${offset}`;

      const usersConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: usersUrlWithPagination,
        headers: {
          'accept': 'application/vnd.api+json',
          'Authorization': `Bearer ${token}`
        }
      };

      console.log(`Fetching users with offset=${offset}...`);
      const usersResponse = await axios.request(usersConfig);
      console.log('Users response received:', usersResponse.status, usersResponse.statusText);

      if (usersResponse.status === 200) {
        const usersData = usersResponse.data.data;

        const formattedUsers = usersData.map(user => ({
          id: user.id,
          name: user.attributes.name,
          email: user.attributes.email,
          groupIds: user.relationships.groups.data.map(group => group.id)
        }));

        allUsers = [...allUsers, ...formattedUsers];

        moreUsers = usersData.length === userLimit;
        offset += userLimit;
      } else {
        console.error(`HTTP Error: ${usersResponse.status} - ${usersResponse.statusText}`);
        moreUsers = false;
      }
    }

    // Group users by their group IDs
    for (const user of allUsers) {
      for (const groupId of user.groupIds) {
        if (!allGroups[groupId]) {
          allGroups[groupId] = [];
        }
        allGroups[groupId].push(user);
      }
    }

    // Fetch and correlate project groups and users
    let projectDetails = [];

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
          projectId: project.id,
          projectName: project.name,
          userName: user.attributes.name,
          userEmail: user.attributes.email,
          groupId: user.relationships.groups.data[0]?.id || 'N/A'
        }));

        let groupMembers = {};

        for (const group of groups) {
          groupMembers[group.id] = {
            groupName: group.attributes.groupname,
            members: allGroups[group.id] || []
          };
        }

        let individualUsers = users.filter(user => user.groupId === 'N/A');

        projectDetails.push({
          projectId: project.id,
          projectName: project.name,
          groups: groupMembers,
          individualUsers: individualUsers.map(user => ({ name: user.userName, email: user.userEmail }))
        });
      } else {
        console.error(`HTTP Error: ${roleAssignmentsResponse.status} - ${roleAssignmentsResponse.statusText}`);
      }
    }

    // Prepare CSV data
    let csvData = [];

    for (const project of projectDetails) {
      for (const groupId in project.groups) {
        const group = project.groups[groupId];
        group.members.forEach(member => {
          csvData.push({
            projectId: project.projectId,
            projectName: project.projectName,
            groupName: group.groupName,
            memberName: member.name,
            memberEmail: member.email,
            individualUsers: ''
          });
        });
      }

      project.individualUsers.forEach(user => {
        csvData.push({
          projectId: project.projectId,
          projectName: project.projectName,
          groupName: 'N/A',
          memberName: '',
          memberEmail: '',
          individualUsers: `${user.name}, ${user.email}`
        });
      });
    }

    const csvWriter = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: 'projectId', title: 'PROJECT ID' },
        { id: 'projectName', title: 'PROJECT NAME' },
        { id: 'groupName', title: 'GROUP NAME' },
        { id: 'memberName', title: 'MEMBER NAME' },
        { id: 'memberEmail', title: 'MEMBER EMAIL' },
        { id: 'individualUsers', title: 'INDIVIDUAL USERS IN A PROJECT' }
      ]
    });

    await csvWriter.writeRecords(csvData);
    console.log('Project details have been saved to projectDetails.csv');

  } catch (error) {
    if (error.response) {
      console.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('Response data:', error.response.data);
    } else {
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

