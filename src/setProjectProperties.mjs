/* ==========================================================================================================
 * 
 *      Description:
 *  
 *          PHASE TWO:  
 * 
 *          Phase two of the script will read from the created file "projectList.json".  Prior to 
 *          running this script, please review the projectList file and update with the information
 *          you would like pubished to the coverity on polaris.  You may remove any projects you 
 *          do not need to update and update any key/value pairs you would like to post to the project.
 *          To run the second phase script: 
 * 
 *                  node ./setProperties.mjs
 * 
 * 
 *      Usage:
 *          
 *          Review the CONFIG.JSON file and populate the email and password information for the user 
 *          running the script.
 * 
 *      Date: 
 *          
 *          May 21, 2024 -- Initial build
 *                  -- David Nester (dnester@synopsys.com)
 * 
 * ==========================================================================================================
 */

import axios from 'axios';
import fs from 'fs/promises';

const configPath = './config.json';
const projectListPath = './projectList.json';

const setProjectProperties = async () => {
  try {
    // Read config from config.json
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);

    console.log('Config data loaded:', config);

    const authUrl = config.authUrlTemplate.replace('{customer}', config.customer);
    const authUrlV2 = config.authUrlV2Template.replace('{customer}', config.customer);
    const setPropertyUrl = config.setPropertyUrlTemplate.replace('{customer}', config.customer);

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


    // Remove if you need to check JWT
    //console.log('Retrieved access token:', token);

    
    // Read project list from projectList.json
    const projectListData = await fs.readFile(projectListPath, 'utf8');
    const projectList = JSON.parse(projectListData);
    console.log('Project list loaded:', projectList);

    // Loop through each project and set properties
    for (const project of projectList) {
      console.log('Setting properties for project ID:', project.id);

      const propertiesConfig = {
        method: 'post',
        url: setPropertyUrl,
        headers: { 
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        data: {
          projects: [project.id],
          properties: project.properties
        }
      };

      try {
        // Request to set properties for the project
        const propertiesResponse = await axios.request(propertiesConfig);
        console.log(`Response for project ID ${project.id}:`, propertiesResponse.status, propertiesResponse.statusText);

        if (propertiesResponse.status === 200) {
          console.log(`Project properties have been set successfully for project ID: ${project.id}`);
        } else {
          console.error(`HTTP Error for project ID ${project.id}: ${propertiesResponse.status} - ${propertiesResponse.statusText}`);
        }
      } catch (error) {
        console.error(`Error setting properties for project ID ${project.id}:`, error.message);
        if (error.response) {
          console.error(`HTTP Error for project ID ${project.id}: ${error.response.status} - ${error.response.statusText}`);
          console.error('Response data:', error.response.data);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      // Handle errors from the server
      console.error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('Response data:', error.response.data);
    }
  }
};

setProjectProperties();


/*
 *      eof.
 */
