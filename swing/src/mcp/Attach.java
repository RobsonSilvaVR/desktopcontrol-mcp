package mcp;

import com.sun.tools.attach.VirtualMachine;

/** Uso: java -cp tools.jar;swing-agent.jar mcp.Attach &lt;pid&gt; &lt;agent.jar&gt; */
public class Attach {
    public static void main(String[] args) throws Exception {
        VirtualMachine vm = VirtualMachine.attach(args[0]);
        try {
            vm.loadAgent(args[1]);
        } finally {
            vm.detach();
        }
    }
}
