/* Chronicle M3 fixed native fixture/transform worker. No generated artifact API. */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <grp.h>
#include <sys/un.h>
#include <netinet/in.h>

#define INPUT_LIMIT 65536
#define MEMORY_LIMIT (16*1024*1024)
static unsigned char input[INPUT_LIMIT];
static const char *stage="unknown";
static void unavailable(void){dprintf(2,"ISOLATION_UNAVAILABLE:%s:%d\n",stage,errno);_exit(78);}
static void require(int okay,const char *label){stage=label;if(!okay)unavailable();}
static void limit(int resource,rlim_t n,const char *label){struct rlimit l={n,n};require(setrlimit(resource,&l)==0,label);}
static void restrict_syscalls(void){
#if !defined(__x86_64__)
  stage="architecture";unavailable();
#endif
/* Kill wrong-architecture and x32 ABI calls; deny everything except bounded IPC and exit.
   All descriptor arguments are checked. No allocator, clock, files, sockets, threads or process calls. */
  struct sock_filter filter[]={
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AUDIT_ARCH_X86_64,1,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_exit,11,0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_exit_group,10,0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_read,0,3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,7,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_write,0,4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,1,3,0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,2,2,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program={(unsigned short)(sizeof filter/sizeof filter[0]),filter};
  require(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program)==0,"seccomp");
}
static void bootstrap(void){
  struct stat s;for(int fd=0;fd<3;fd++)require(fstat(fd,&s)==0&&(S_ISFIFO(s.st_mode)||S_ISSOCK(s.st_mode)),"stdio-pipes");
  require(syscall(SYS_close_range,3,~0U,0)==0,"close-descriptors");
  require(clearenv()==0,"clear-environment");
  limit(RLIMIT_CORE,0,"core");limit(RLIMIT_FSIZE,0,"file-size");
  limit(RLIMIT_CPU,1,"cpu");limit(RLIMIT_AS,MEMORY_LIMIT,"address-space");
  limit(RLIMIT_STACK,64*1024,"stack");limit(RLIMIT_NPROC,1,"processes");limit(RLIMIT_NOFILE,3,"descriptors");
  require(chroot(".")==0&&chdir("/")==0,"empty-root");
  require(setgroups(0,NULL)==0,"supplementary-groups");
  require(setgid(65534)==0&&setuid(65534)==0&&getuid()==65534&&getgid()==65534,"unprivileged-identity");
  require(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)==0,"no-new-privileges");
  require(prctl(PR_SET_DUMPABLE,0)==0,"nondumpable");
  /* Every runtime page is locked; allocations after confinement are denied by seccomp. */
  require(mlockall(MCL_CURRENT|MCL_FUTURE)==0,"locked-memory");
  restrict_syscalls();
}
static void emit(const char *s){size_t n=strlen(s);while(n){ssize_t w=write(1,s,n);if(w<=0)_exit(71);s+=w;n-=(size_t)w;}}
static int denied(long r){return r==-1&&errno==EPERM;}
static void report(int okay){emit(okay?"{\"schema\":1,\"denied\":true}\n":"{\"schema\":1,\"denied\":false}\n");_exit(okay?0:72);}
static void fixture(const char *name){
  if(!strcmp(name,"network")){int ok=1;int domains[]={AF_INET,AF_INET6,AF_UNIX};for(int i=0;i<3;i++)for(int j=0;j<2;j++)ok&=denied(syscall(SYS_socket,domains[i],j?SOCK_DGRAM:SOCK_STREAM,0));
    struct sockaddr_in a={.sin_family=AF_INET,.sin_port=1};ok&=denied(syscall(SYS_connect,1,&a,sizeof a));ok&=denied(syscall(SYS_sendto,1,"x",1,0,&a,sizeof a));report(ok);}
  if(!strcmp(name,"filesystem")){int ok=1;const char *paths[]={"/secret","/proc/self/environ","/dev/null","../canary","/sys","/browser/profile"};for(int i=0;i<6;i++)ok&=denied(syscall(SYS_openat,AT_FDCWD,paths[i],O_RDWR|O_CREAT,0600));ok&=denied(syscall(SYS_symlink,"/secret","alias"));ok&=denied(syscall(SYS_link,"/secret","hard"));report(ok);}
  if(!strcmp(name,"descriptors")){int ok=1;char c;for(int fd=3;fd<32;fd++)ok&=denied(syscall(SYS_read,fd,&c,1));ok&=denied(syscall(SYS_write,0,"x",1));ok&=denied(syscall(SYS_dup,1));report(ok);}
  if(!strcmp(name,"processes")){int ok=denied(syscall(SYS_fork));ok&=denied(syscall(SYS_clone,0,0,0,0,0));ok&=denied(syscall(SYS_execve,"/bin/sh",NULL,NULL));ok&=denied(syscall(SYS_kill,1,SIGTERM));report(ok);}
  if(!strcmp(name,"memory")){int ok=denied(syscall(SYS_mmap,NULL,32*1024*1024,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0));ok&=denied(syscall(SYS_munlockall));report(ok);}
  if(!strcmp(name,"environment")){report(getenv("HOME")==NULL&&getenv("CHRONICLE_CANARY")==NULL);}
  if(!strcmp(name,"infinite-loop")){volatile unsigned long n=0;for(;;)n++;}
  if(!strcmp(name,"output-flood")){for(;;)emit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");}
  if(!strcmp(name,"diagnostic-flood")){for(;;){if(write(2,"synthetic-diagnostic",20)<0)_exit(71);}}
  if(!strcmp(name,"malformed-output")){emit("{\"schema\":1,\"schema\":2}");_exit(0);}
  if(!strcmp(name,"markup-output")){emit("{\"schema\":1,\"html\":\"<script>x</script>\"}");_exit(0);}
  if(!strcmp(name,"forged-output")){emit("{\"schema\":1,\"count\":1,\"sum\":999999}");_exit(0);}
  if(!strcmp(name,"crash")){_exit(73);}
  if(!strcmp(name,"partial-output")){emit("{");_exit(0);}
  _exit(74);
}
int main(int argc,char **argv){
  if(argc!=2){stage="invocation";unavailable();}
  char operation[64];require(strlen(argv[1])<sizeof operation,"operation");strcpy(operation,argv[1]);
  bootstrap();
  if(strcmp(operation,"sum-v1")&&strcmp(operation,"validate-v1"))fixture(operation);
  size_t length=0;for(;;){if(length==sizeof input)_exit(75);ssize_t n=read(0,input+length,sizeof input-length);if(n<0)_exit(76);if(!n)break;length+=(size_t)n;}
  if(length<4)_exit(77);
  uint32_t count;memcpy(&count,input,4);size_t values_end=4+(size_t)count*8;
  if(count>2000||length<values_end)_exit(77);
  if(!strcmp(operation,"sum-v1")&&length!=values_end)_exit(77);
  double sum=0;for(uint32_t i=0;i<count;i++){double v;memcpy(&v,input+4+i*8,8);sum+=v;}
  char result[256];int n=snprintf(result,sizeof result,"{\"schema\":1,\"count\":%u,\"sum\":%.17g}\n",count,sum);if(n<0||(size_t)n>=sizeof result)_exit(77);
  if(!strcmp(operation,"validate-v1")){
    if(length<values_end+4)_exit(79);
    uint32_t output_length;memcpy(&output_length,input+values_end,4);
    if(output_length>4096||length!=values_end+4+output_length||output_length!=(uint32_t)n||memcmp(input+values_end+4,result,output_length))_exit(79);
  }
  emit(result);_exit(0);
}
