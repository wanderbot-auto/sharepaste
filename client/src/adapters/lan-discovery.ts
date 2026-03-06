import mdns from "multicast-dns";

export interface LanPeer {
  deviceId: string;
  host: string;
  port: number;
}

export class LanDiscovery {
  private readonly serviceName: string;

  private daemon = mdns();

  constructor(serviceName = "_sharepaste._tcp.local") {
    this.serviceName = serviceName;
  }

  startAnnounce(deviceId: string, host: string, port: number): void {
    this.daemon.respond({
      answers: [
        {
          name: `${deviceId}.${this.serviceName}`,
          type: "SRV",
          data: {
            port,
            target: host
          },
          ttl: 30
        }
      ]
    });
  }

  discover(onPeer: (peer: LanPeer) => void): void {
    this.daemon.on("response", (response: any) => {
      const answers = response.answers ?? [];
      for (const answer of answers) {
        if (answer.type !== "SRV" || typeof answer.name !== "string") {
          continue;
        }
        if (!answer.name.endsWith(`.${this.serviceName}`)) {
          continue;
        }

        const deviceId = answer.name.replace(`.${this.serviceName}`, "");
        onPeer({
          deviceId,
          host: answer.data.target,
          port: answer.data.port
        });
      }
    });

    this.daemon.query({ questions: [{ name: this.serviceName, type: "SRV" }] });
  }

  stop(): void {
    this.daemon.destroy();
  }
}
