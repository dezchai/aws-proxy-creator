import AWS from "aws-sdk";

const securityGroupName = ""; // MUST CREATE IN AWS FIRST

interface Proxy {
  ip: string | undefined;
  port: number;
  username: string;
  password: string;
  instanceID: string;
}

class ProxyCreator {
  ec2: AWS.EC2;
  proxyUsername: string;
  proxyPassword: string;
  securityGroupId: string | undefined;
  userData: string;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    proxyUsername: string,
    proxyPassword: string
  ) {
    AWS.config.update({
      region: region,
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    });

    this.ec2 = new AWS.EC2();
    this.proxyUsername = proxyUsername;
    this.proxyPassword = proxyPassword;
    this.userData = Buffer.from(
      `#!/bin/bash
sudo apt-get update
sudo apt-get -y install squid 
sudo apt-get -y install apache2-utils
sudo echo -e "auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwd\nacl authenticated proxy_auth REQUIRED\nhttp_access allow authenticated" >> /etc/squid/squid.conf
sudo sed -i '/http_access deny all/d' /etc/squid/squid.conf
sudo htpasswd -b -c /etc/squid/passwd ${proxyUsername} ${proxyPassword}
sudo service squid stop
sudo systemctl enable squid
sudo service squid start
`
    ).toString("base64");
  }
  /** Checks if the proper security group already exists
   * @returns boolean
   */
  checkSecurityGroups = async (): Promise<string | undefined> => {
    const { SecurityGroups } = await this.ec2
      .describeSecurityGroups()
      .promise();

    return SecurityGroups?.find(
      (securityGroup: AWS.EC2.SecurityGroup) =>
        securityGroup.GroupName === securityGroupName
    )?.GroupId;
  };
  /** Create the proper security group 
  Only allow TCP 3128 inbound
  Allow all outbound
  */
  createSecurityGroup = async (): Promise<string | undefined> => {
    const securityGroup = await this.ec2
      .createSecurityGroup({
        GroupName: securityGroupName,
        Description: "Security group for Biznis HTTP proxy",
      })
      .promise();
    this.securityGroupId = securityGroup.GroupId;
    await this.ec2
      .authorizeSecurityGroupIngress({
        GroupId: this.securityGroupId,
        IpPermissions: [
          {
            IpProtocol: "tcp",
            FromPort: 3128,
            ToPort: 3128,
            IpRanges: [
              {
                CidrIp: "0.0.0.0/0",
              },
            ],
          },
        ],
      })
      .promise();

    return securityGroup?.GroupId;
  };

  createInstance = async (securityGroupID: string): Promise<Proxy> => {
    const instance = await this.ec2
      .runInstances({
        ImageId: "ami-0574da719dca65348", // Stock Ubuntu 22 AWS AMI
        MinCount: 1,
        MaxCount: 1,
        InstanceType: "t2.nano",
        SecurityGroupIds: [securityGroupID],
        UserData: this.userData,
        // KeyName: 'dummy' // NAME OF KEYPAIR IN AWS, NEED TO CREATE IN AWS FIRST
      })
      .promise();
    //@ts-ignore
    const instanceId: string = instance.Instances[0].InstanceId;
    if (instanceId === undefined) throw new Error("Instance ID not found");
    await this.ec2
      .createTags({
        Resources: [instanceId],
        Tags: [
          {
            Key: "Name",
            Value: "HTTP proxy",
          },
        ],
      })
      .promise();
    const instanceInfo = await this.ec2
      .describeInstances({
        InstanceIds: [instanceId],
      })
      .promise();

    // @ts-ignore
    const ip = instanceInfo.Reservations[0].Instances[0].PublicIpAddress;

    return {
      ip,
      port: 3128,
      username: this.proxyUsername,
      password: this.proxyPassword,
      instanceID: instanceId,
    };
  };
}

export default ProxyCreator;
