package mcp;

import java.awt.Component;
import java.awt.Container;
import java.awt.EventQueue;
import java.awt.KeyboardFocusManager;
import java.awt.Point;
import java.awt.Toolkit;
import java.awt.Window;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.Instrumentation;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import javax.swing.AbstractButton;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPasswordField;
import javax.swing.JTable;
import javax.swing.text.JTextComponent;

/**
 * Agente JVM: expõe a árvore de componentes Swing e injeta eventos na EDT, sem depender de foco de janela
 * nem de acessibilidade do SO. Protocolo: uma linha "token\tcomando\targ..." por requisição, uma linha JSON de resposta.
 */
public class SwingAgent {

    private static final int MAX_NODES = 4000;
    private static String token;
    private static boolean started;

    public static void premain(String args, Instrumentation inst) {
        start();
    }

    public static void agentmain(String args, Instrumentation inst) {
        start();
    }

    private static synchronized void start() {
        if (started) {
            return;
        }
        started = true;
        try {
            final ServerSocket server = new ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"));
            token = UUID.randomUUID().toString();
            String pid = ManagementFactory.getRuntimeMXBean().getName().split("@")[0];
            File file = new File(System.getProperty("java.io.tmpdir"), "mcp-swing-" + pid + ".json");
            FileWriter w = new FileWriter(file);
            w.write("{\"port\":" + server.getLocalPort() + ",\"token\":\"" + token + "\"}");
            w.close();
            file.deleteOnExit();
            Thread t = new Thread("mcp-swing-agent") {
                public void run() {
                    while (true) {
                        try {
                            final Socket s = server.accept();
                            Thread c = new Thread("mcp-swing-conn") {
                                public void run() {
                                    serve(s);
                                }
                            };
                            c.setDaemon(true);
                            c.start();
                        } catch (Exception e) {
                            return;
                        }
                    }
                }
            };
            t.setDaemon(true);
            t.start();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static void serve(Socket s) {
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), "UTF-8"));
            PrintWriter out = new PrintWriter(new java.io.OutputStreamWriter(s.getOutputStream(), "UTF-8"), true);
            String line;
            while ((line = in.readLine()) != null) {
                out.println(handle(line));
            }
        } catch (Exception ignored) {
        } finally {
            try {
                s.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static String handle(String line) {
        try {
            String[] p = line.split("\t", -1);
            if (p.length < 2 || !token.equals(p[0])) {
                return err("token inválido");
            }
            for (int i = 2; i < p.length; i++) {
                p[i] = p[i].replace("\\t", "\t").replace("\\n", "\n").replace("\\\\", "\\");
            }
            final String cmd = p[1];
            final String a1 = p.length > 2 ? p[2] : "";
            final String a2 = p.length > 3 ? p[3] : "";
            String r = onEdt(new Callable<String>() {
                public String call() throws Exception {
                    return run(cmd, a1, a2);
                }
            });
            return r;
        } catch (Throwable t) {
            return err(String.valueOf(t.getMessage() != null ? t.getMessage() : t));
        }
    }

    private static String onEdt(final Callable<String> c) throws Exception {
        final String[] box = new String[1];
        final Throwable[] fail = new Throwable[1];
        EventQueue.invokeAndWait(new Runnable() {
            public void run() {
                try {
                    box[0] = c.call();
                } catch (Throwable t) {
                    fail[0] = t;
                }
            }
        });
        if (fail[0] != null) {
            return err(String.valueOf(fail[0].getMessage() != null ? fail[0].getMessage() : fail[0]));
        }
        return box[0];
    }

    private static String run(String cmd, String a1, String a2) throws Exception {
        if ("ping".equals(cmd)) {
            return "{\"ok\":true}";
        }
        if ("tree".equals(cmd)) {
            return tree("text".equals(a1));
        }
        if ("click".equals(cmd)) {
            return click(find(a1));
        }
        if ("settext".equals(cmd)) {
            Component c = find(a1);
            if (!(c instanceof JTextComponent)) {
                return err("componente não é campo de texto");
            }
            ((JTextComponent) c).setText(a2);
            return "{\"ok\":true}";
        }
        if ("focus".equals(cmd)) {
            return "{\"ok\":" + find(a1).requestFocusInWindow() + "}";
        }
        if ("key".equals(cmd)) {
            return key(a1);
        }
        if ("type".equals(cmd)) {
            for (int i = 0; i < a1.length(); i++) {
                char ch = a1.charAt(i);
                postKey(KeyEvent.KEY_PRESSED, KeyEvent.getExtendedKeyCodeForChar(ch), ch, 0);
                postKey(KeyEvent.KEY_TYPED, KeyEvent.VK_UNDEFINED, ch, 0);
                postKey(KeyEvent.KEY_RELEASED, KeyEvent.getExtendedKeyCodeForChar(ch), ch, 0);
            }
            return "{\"ok\":true}";
        }
        if ("cells".equals(cmd)) {
            return cells(find(a1));
        }
        return err("comando desconhecido: " + cmd);
    }

    private static List<Window> windows() {
        List<Window> out = new ArrayList<Window>();
        for (Window w : Window.getWindows()) {
            if (w.isShowing()) {
                out.add(w);
            }
        }
        return out;
    }

    private static Component find(String path) {
        String[] parts = path.split("/");
        List<Window> ws = windows();
        Component c = ws.get(Integer.parseInt(parts[0]));
        for (int i = 1; i < parts.length; i++) {
            c = ((Container) c).getComponent(Integer.parseInt(parts[i]));
        }
        return c;
    }

    private static String tree(boolean onlyText) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"nodes\":[");
        int[] count = {0};
        List<Window> ws = windows();
        for (int i = 0; i < ws.size(); i++) {
            walk(ws.get(i), String.valueOf(i), onlyText, sb, count);
        }
        if (count[0] > 0) {
            sb.setLength(sb.length() - 1);
        }
        return sb.append("]}").toString();
    }

    private static void walk(Component c, String path, boolean onlyText, StringBuilder sb, int[] count) {
        if (count[0] >= MAX_NODES || !c.isShowing()) {
            return;
        }
        String text = text(c);
        if (!onlyText || (text != null && text.length() > 0)) {
            count[0]++;
            Point loc = c.getLocationOnScreen();
            sb.append("{\"p\":\"").append(path).append("\",\"c\":").append(q(c.getClass().getName()));
            if (c.getName() != null) {
                sb.append(",\"n\":").append(q(c.getName()));
            }
            if (text != null) {
                sb.append(",\"t\":").append(q(text));
            }
            sb.append(",\"e\":").append(c.isEnabled()).append(",\"x\":").append(loc.x).append(",\"y\":").append(loc.y)
                    .append(",\"w\":").append(c.getWidth()).append(",\"h\":").append(c.getHeight()).append("},");
        }
        if (c instanceof Container) {
            Component[] kids = ((Container) c).getComponents();
            for (int i = 0; i < kids.length; i++) {
                walk(kids[i], path + "/" + i, onlyText, sb, count);
            }
        }
    }

    private static String text(Component c) {
        if (c instanceof JPasswordField) {
            return "***";
        }
        if (c instanceof AbstractButton) {
            return ((AbstractButton) c).getText();
        }
        if (c instanceof JLabel) {
            return ((JLabel) c).getText();
        }
        if (c instanceof JTextComponent) {
            return ((JTextComponent) c).getText();
        }
        if (c instanceof JComboBox) {
            Object o = ((JComboBox) c).getSelectedItem();
            return o == null ? null : o.toString();
        }
        return null;
    }

    private static String cells(Component c) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"rows\":[");
        if (c instanceof JTable) {
            JTable t = (JTable) c;
            for (int r = 0; r < Math.min(t.getRowCount(), 200); r++) {
                sb.append(r > 0 ? "," : "").append("[");
                for (int k = 0; k < t.getColumnCount(); k++) {
                    Object v = t.getValueAt(r, k);
                    sb.append(k > 0 ? "," : "").append(q(v == null ? "" : v.toString()));
                }
                sb.append("]");
            }
        } else if (c instanceof JList) {
            JList l = (JList) c;
            for (int r = 0; r < Math.min(l.getModel().getSize(), 200); r++) {
                sb.append(r > 0 ? "," : "").append("[").append(q(String.valueOf(l.getModel().getElementAt(r)))).append("]");
            }
        } else {
            return err("componente não é tabela nem lista");
        }
        return sb.append("]}").toString();
    }

    private static String click(Component c) {
        if (c instanceof AbstractButton) {
            ((AbstractButton) c).doClick();
            return "{\"ok\":true,\"via\":\"doClick\"}";
        }
        int x = c.getWidth() / 2;
        int y = c.getHeight() / 2;
        long now = System.currentTimeMillis();
        EventQueue q = Toolkit.getDefaultToolkit().getSystemEventQueue();
        q.postEvent(new MouseEvent(c, MouseEvent.MOUSE_PRESSED, now, MouseEvent.BUTTON1_DOWN_MASK, x, y, 1, false, MouseEvent.BUTTON1));
        q.postEvent(new MouseEvent(c, MouseEvent.MOUSE_RELEASED, now, 0, x, y, 1, false, MouseEvent.BUTTON1));
        q.postEvent(new MouseEvent(c, MouseEvent.MOUSE_CLICKED, now, 0, x, y, 1, false, MouseEvent.BUTTON1));
        return "{\"ok\":true,\"via\":\"mouseEvents\"}";
    }

    private static String key(String spec) throws Exception {
        String[] parts = spec.split("\\+");
        int mods = 0;
        for (int i = 0; i < parts.length - 1; i++) {
            String m = parts[i].toLowerCase();
            if (m.equals("ctrl") || m.equals("control") || m.equals("cmdorctrl")) {
                mods |= KeyEvent.CTRL_DOWN_MASK;
            } else if (m.equals("shift")) {
                mods |= KeyEvent.SHIFT_DOWN_MASK;
            } else if (m.equals("alt") || m.equals("option")) {
                mods |= KeyEvent.ALT_DOWN_MASK;
            } else {
                throw new IllegalArgumentException("modificador desconhecido: " + parts[i]);
            }
        }
        String name = parts[parts.length - 1];
        int vk;
        char ch = KeyEvent.CHAR_UNDEFINED;
        if (name.length() == 1) {
            ch = name.charAt(0);
            vk = KeyEvent.getExtendedKeyCodeForChar(ch);
        } else {
            String n = name.toUpperCase();
            if (n.equals("ESC")) {
                n = "ESCAPE";
            } else if (n.equals("RETURN")) {
                n = "ENTER";
            } else if (n.equals("PAGEUP")) {
                n = "PAGE_UP";
            } else if (n.equals("PAGEDOWN")) {
                n = "PAGE_DOWN";
            }
            vk = KeyEvent.class.getField("VK_" + n).getInt(null);
            if (n.equals("ENTER")) {
                ch = '\n';
            } else if (n.equals("TAB")) {
                ch = '\t';
            } else if (n.equals("SPACE")) {
                ch = ' ';
            } else if (n.equals("BACK_SPACE")) {
                ch = '\b';
            }
        }
        postKey(KeyEvent.KEY_PRESSED, vk, ch, mods);
        if (ch != KeyEvent.CHAR_UNDEFINED && (mods & (KeyEvent.CTRL_DOWN_MASK | KeyEvent.ALT_DOWN_MASK)) == 0) {
            postKey(KeyEvent.KEY_TYPED, KeyEvent.VK_UNDEFINED, ch, mods);
        }
        postKey(KeyEvent.KEY_RELEASED, vk, ch, mods);
        return "{\"ok\":true}";
    }

    private static void postKey(int id, int vk, char ch, int mods) throws Exception {
        KeyboardFocusManager fm = KeyboardFocusManager.getCurrentKeyboardFocusManager();
        Component target = fm.getFocusOwner();
        boolean focused = target != null;
        if (target == null) {
            target = fm.getActiveWindow();
        }
        if (target == null) {
            List<Window> ws = windows();
            if (!ws.isEmpty()) {
                Window w = ws.get(0);
                target = w.getMostRecentFocusOwner() != null ? w.getMostRecentFocusOwner() : w;
            }
        }
        if (target == null) {
            throw new IllegalStateException("nenhuma janela Swing visível");
        }
        KeyEvent e = new KeyEvent(target, id, System.currentTimeMillis(), mods, vk, ch);
        if (focused || !dispatchWithoutFocus(fm, e)) {
            Toolkit.getDefaultToolkit().getSystemEventQueue().postEvent(e);
        }
    }

    /** Sem foco do SO o gerenciador de foco descarta a tecla; entrega direto aos KeyEventDispatchers do app. */
    private static boolean dispatchWithoutFocus(KeyboardFocusManager fm, KeyEvent e) {
        try {
            java.lang.reflect.Method m = KeyboardFocusManager.class.getDeclaredMethod("getKeyEventDispatchers");
            m.setAccessible(true);
            java.util.List<?> list = (java.util.List<?>) m.invoke(fm);
            if (list == null) {
                return false;
            }
            for (Object d : new ArrayList<Object>(list)) {
                if (((java.awt.KeyEventDispatcher) d).dispatchKeyEvent(e)) {
                    return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private static String err(String m) {
        return "{\"ok\":false,\"error\":" + q(m) + "}";
    }

    private static String q(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                sb.append('\\').append(c);
            } else if (c < 0x20) {
                sb.append(String.format("\\u%04x", (int) c));
            } else {
                sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
