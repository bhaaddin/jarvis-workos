const session=await fetch('http://127.0.0.1:18791/api/session');
if(!session.ok)throw new Error('Command Center is unavailable');
const cookie=session.headers.get('set-cookie').split(';')[0];
async function read(route){const response=await fetch('http://127.0.0.1:18791/api/operator'+route,{headers:{Cookie:cookie}});if(!response.ok)throw new Error('Status request failed: '+response.status);return response.json();}
const [skills,clinic,mail,health]=await Promise.all([read('/skills'),read('/connections/clinic'),read('/connections/mail'),fetch('http://127.0.0.1:18801/health').then(response=>response.json())]);
console.log(JSON.stringify({service:health.service,storage:health.storage,agentQueue:health.agentQueue,actionQueue:health.actionQueue,
  callableTools:skills.skills.filter(value=>value.state==='ready').map(value=>value.id),
  clinicConnected:clinic.connected,clinicReachable:clinic.apiReachable,clinicContractVerified:clinic.contractVerified,
  clinicProfile:clinic.apiProfile,clinicReadOnly:clinic.readOnly,clinicMessage:clinic.message,
  emailConnected:mail.connected,smtpConfigured:mail.sendingConfigured},null,2));
