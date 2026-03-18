const os = require('os');
const config = require('./config.js');

class Metrics {
  constructor() {
    this.totalRequests = 0;
    this.getRequests = 0;
    this.postRequests = 0;
    this.putRequests = 0;
    this.deleteRequests = 0;

    this.activeUsers = 0;

    this.authSuccessful = 0;
    this.authFailed = 0;

    this.pizzasSold = 0;
    this.pizzaCreationFailures = 0;
    this.revenue = 0;

    this.serviceLatencies = [];
    this.pizzaLatencies = [];

    this.requestTracker = this.requestTracker.bind(this);

    if (config.metrics) {
      const timer = setInterval(() => {
        try {
          this.sendAllMetrics();
        } catch (error) {
          console.error('Error sending metrics:', error);
        }
      }, 5000);
      timer.unref();
    }
  }

  requestTracker(req, res, next) {
    this.totalRequests++;
    switch (req.method) {
      case 'GET':
        this.getRequests++;
        break;
      case 'POST':
        this.postRequests++;
        break;
      case 'PUT':
        this.putRequests++;
        break;
      case 'DELETE':
        this.deleteRequests++;
        break;
    }

    const start = Date.now();
    res.on('close', () => {
      const duration = Date.now() - start;
      this.serviceLatencies.push(duration);
    });

    next();
  }

  incrementActiveUsers() {
    this.activeUsers++;
  }

  decrementActiveUsers() {
    this.activeUsers--;
  }

  incrementAuthSuccess() {
    this.authSuccessful++;
  }

  incrementAuthFailure() {
    this.authFailed++;
  }

  trackPizzaPurchase(count, revenue) {
    this.pizzasSold += count;
    this.revenue += revenue;
  }

  trackPizzaFailure() {
    this.pizzaCreationFailures++;
  }

  trackPizzaLatency(latencyMs) {
    this.pizzaLatencies.push(latencyMs);
  }

  getCpuUsagePercentage() {
    const cpus = os.cpus().length || 1;
    const cpuUsage = os.loadavg()[0] / cpus;
    return parseFloat((cpuUsage * 100).toFixed(2));
  }

  getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    return parseFloat((((totalMemory - freeMemory) / totalMemory) * 100).toFixed(2));
  }

  sendAllMetrics() {
    // HTTP requests
    this.sendMetric('http_requests_total', this.totalRequests, 'sum', '1');
    this.sendMetric('http_requests_get', this.getRequests, 'sum', '1');
    this.sendMetric('http_requests_post', this.postRequests, 'sum', '1');
    this.sendMetric('http_requests_put', this.putRequests, 'sum', '1');
    this.sendMetric('http_requests_delete', this.deleteRequests, 'sum', '1');

    // Active users
    this.sendMetric('active_users', this.activeUsers, 'gauge', '1');

    // Auth
    this.sendMetric('auth_successful', this.authSuccessful, 'sum', '1');
    this.sendMetric('auth_failed', this.authFailed, 'sum', '1');

    // System
    this.sendMetric('cpu_usage', this.getCpuUsagePercentage(), 'gauge', '%');
    this.sendMetric('memory_usage', this.getMemoryUsagePercentage(), 'gauge', '%');

    // Pizzas
    this.sendMetric('pizzas_sold', this.pizzasSold, 'sum', '1');
    this.sendMetric('pizza_creation_failures', this.pizzaCreationFailures, 'sum', '1');
    this.sendMetric('pizza_revenue', parseFloat(this.revenue.toFixed(4)), 'sum', '1');

    // Latency
    if (this.serviceLatencies.length > 0) {
      const avg = this.serviceLatencies.reduce((a, b) => a + b, 0) / this.serviceLatencies.length;
      this.sendMetric('service_endpoint_latency', parseFloat(avg.toFixed(2)), 'gauge', 'ms');
      this.serviceLatencies = [];
    }
    if (this.pizzaLatencies.length > 0) {
      const avg = this.pizzaLatencies.reduce((a, b) => a + b, 0) / this.pizzaLatencies.length;
      this.sendMetric('pizza_creation_latency', parseFloat(avg.toFixed(2)), 'gauge', 'ms');
      this.pizzaLatencies = [];
    }
  }

  sendMetric(metricName, metricValue, type, unit) {
    if (!config.metrics) return;

    const dataPoint = {
      timeUnixNano: `${Date.now()}000000`,
      attributes: [{ key: 'source', value: { stringValue: config.metrics.source } }],
    };

    if (Number.isInteger(metricValue)) {
      dataPoint.asInt = metricValue;
    } else {
      dataPoint.asDouble = metricValue;
    }

    const metric = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: metricName,
                  unit: unit,
                  [type]: {
                    dataPoints: [dataPoint],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    if (type === 'sum') {
      metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
      metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].isMonotonic = true;
    }

    fetch(config.metrics.endpointUrl, {
      method: 'POST',
      body: JSON.stringify(metric),
      headers: {
        Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
        'Content-Type': 'application/json',
      },
    }).catch((error) => {
      console.error('Error pushing metrics:', error);
    });
  }
}

const metrics = new Metrics();
module.exports = metrics;
