// main.bicep
@description('The name of your project (e.g., "my-fileshare"). Used to generate unique names.')
param projectName string = 'fileshare-app'

@description('The admin password for the MySQL Database.')
@secure()
param dbPassword string

@description('Location for all resources.')
param location string = resourceGroup().location

// 1. Create the App Service Plan (The "Server" for your apps)
resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: '${projectName}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: 'B1' // Basic Tier. Use 'F1' for Free (limited).
    tier: 'Basic'
  }
  properties: {
    reserved: true // Required for Linux
  }
}

// 2. Create the MySQL Database Server
resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: '${projectName}-mysql'
  location: location
  sku: {
    name: 'Standard_B1ms' // Burstable, cost-effective
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: 'adminuser'
    administratorLoginPassword: dbPassword
    version: '8.0.21'
    storage: {
      storageSizeGB: 20
      iops: 360
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
  }
}

// 3. Create the specific Database inside the server
resource mysqlDB 'Microsoft.DBforMySQL/flexibleServers/databases@2023-12-30' = {
  parent: mysqlServer
  name: 'filesharedb'
  properties: {
    charset: 'utf8'
    collation: 'utf8_general_ci'
  }
}

// 4. Firewall Rule: Allow Azure Services (The Web App) to reach MySQL
resource allowAzureIPs 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = {
  parent: mysqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0' // This specific IP represents "Azure Internal"
    endIpAddress: '0.0.0.0'
  }
}

// 5. Deploy Backend Module (and pass MySQL credentials)
module backend 'backend.bicep' = {
  name: 'backend-deployment'
  params: {
    webAppName: '${projectName}-backend'
    location: location
    appServicePlanId: appServicePlan.id
    // Pass these to your Node app environment variables
    dbHost: mysqlServer.properties.fullyQualifiedDomainName
    dbUser: 'adminuser'
    dbPass: dbPassword
    dbName: mysqlDB.name
  }
}

// 6. Deploy Frontend Module
module frontend 'frontend.bicep' = {
  name: 'frontend-deployment'
  params: {
    webAppName: '${projectName}-frontend'
    location: location
    appServicePlanId: appServicePlan.id
    // Inject the Backend URL so the frontend knows where to talk
    // Note: ensure your backend.bicep has 'output defaultHostName string'
    startupCommand: 'find /home/site/wwwroot -name index.html -exec sed -i "s|__API_URL_PLACEHOLDER__|https://${backend.outputs.defaultHostName}/api|g" {} + && pm2 serve /home/site/wwwroot/dist --no-daemon --spa'
  }
}