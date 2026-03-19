export const VEO_URL_TMP = 'https://sage3-vnc.cis230038.projects.jetstream-cloud.org';

export class ContainerAPI {
  static async init(appId: string, container: string, enviromentVariable: {}) {
    const payload: any = {
      vm: container,
      env: enviromentVariable,
    };

    return await fetch(`${VEO_URL_TMP}/api/vm/any/${appId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then((response) => response.json())
      .then((json) => json);
  }

  static async check(appId: string) {
    return await fetch(`${VEO_URL_TMP}/api/vm/ws/${appId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((response) => response.json())
      .then((json) => json);
  }
}
